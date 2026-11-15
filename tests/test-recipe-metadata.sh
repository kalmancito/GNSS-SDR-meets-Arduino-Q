#!/usr/bin/env bash
# Static checks on the Yocto metadata of this repository. They need no build
# environment and run in seconds, anywhere bash and python3 are available.
#
#   tests/test-recipe-metadata.sh
#
# What they guard is the reproducibility contract of the project:
#   - every source is pinned to an exact revision (no AUTOREV, no floating branch),
#   - nothing is downloaded outside do_fetch,
#   - no host-specific compiler tuning,
#   - layer compatibility is declared only for the release that is built.
#
# Parsing with BitBake itself (bitbake -p) is a separate step that needs the
# build host: scripts/build-gnss-image.sh --parse
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
layer="$repo/meta-gnss-uno-q"
cd "$repo"

# Prefer an interpreter that has PyYAML (needed to parse the kas files).
python_bin=""
for candidate in python3 python; do
    if command -v "$candidate" > /dev/null 2>&1; then
        [ -n "$python_bin" ] || python_bin="$candidate"
        if "$candidate" -c 'import yaml' > /dev/null 2>&1; then
            python_bin="$candidate"
            break
        fi
    fi
done
[ -n "$python_bin" ] || { echo "error: python3 not found" >&2; exit 2; }

fails=0
pending=0
pass() { printf '  PASS     %s\n' "$*"; }
fail() { printf '  FAIL     %s\n' "$*"; fails=$((fails + 1)); }
pend() { printf '  PENDING  %s\n' "$*"; pending=$((pending + 1)); }

# Recipe text with comment lines removed, as "file:line:text".
recipe_lines() {
    find "$layer" -type f \( -name '*.bb' -o -name '*.bbappend' -o -name '*.inc' -o -name '*.conf' \) -print0 |
        xargs -0 grep -nHvE '^[[:space:]]*#' | sed "s#^$repo/##"
}

echo "Recipes ($(find "$layer" -name '*.bb' | wc -l | tr -d ' ') .bb, $(find "$layer" -name '*.bbappend' | wc -l | tr -d ' ') .bbappend)"

# ---- no floating revisions ---------------------------------------------------------
hits="$(recipe_lines | grep -E 'AUTOREV' || true)"
[ -z "$hits" ] && pass "no AUTOREV" || { fail "AUTOREV is used:"; echo "$hits" | sed 's/^/             /'; }

bad=0
while IFS= read -r line; do
    rev="$(sed -E 's/.*=[[:space:]]*"([^"]*)".*/\1/' <<< "$line")"
    if ! [[ "$rev" =~ ^[0-9a-f]{40}$ ]]; then
        fail "SRCREV is not a full 40-character commit id: $line"
        bad=1
    fi
done < <(recipe_lines | grep -E ':[[:space:]]*SRCREV(_[A-Za-z0-9_-]+)?[[:space:]]*=' || true)
[ "$bad" -eq 0 ] && pass "every SRCREV is a full commit id"

# Every recipe that fetches from git must pin a SRCREV.
bad=0
while IFS= read -r f; do
    if grep -qE '(git|gitsm)://' "$f" && ! grep -qE '^[[:space:]]*SRCREV' "$f"; then
        fail "$(basename "$f") fetches from git without a SRCREV"
        bad=1
    fi
done < <(find "$layer" -name '*.bb')
[ "$bad" -eq 0 ] && pass "every git source has a SRCREV"

# Tarball sources must carry a checksum.
bad=0
while IFS= read -r f; do
    if grep -qE 'inherit.*\bpypi\b|https?://[^ "]+\.(tar\.[a-z0-9]+|tgz|zip)' "$f" && ! grep -qE 'SRC_URI\[[a-z0-9.]*sha256sum\]' "$f"; then
        fail "$(basename "$f") downloads an archive without a sha256sum"
        bad=1
    fi
done < <(find "$layer" -name '*.bb')
[ "$bad" -eq 0 ] && pass "every downloaded archive has a sha256sum"

# ---- no network outside do_fetch ---------------------------------------------------------
hits="$(recipe_lines | grep -E '\[network\][[:space:]]*=[[:space:]]*"1"' || true)"
[ -z "$hits" ] && pass "no task is allowed network access" || { fail "network access enabled for a build task:"; echo "$hits" | sed 's/^/             /'; }

# ---- no host-specific tuning ----------------------------------------------------------------
hits="$(recipe_lines | grep -E -- '-m(arch|tune|cpu)=native' || true)"
[ -z "$hits" ] && pass "no -march/-mtune/-mcpu=native" || { fail "host-specific compiler flag:"; echo "$hits" | sed 's/^/             /'; }

# ---- layer compatibility ----------------------------------------------------------------------
compat="$(sed -n 's/^LAYERSERIES_COMPAT_gnss-uno-q[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' "$layer/conf/layer.conf")"
[ "$compat" = "wrynose" ] && pass "LAYERSERIES_COMPAT is exactly \"wrynose\"" \
    || fail "LAYERSERIES_COMPAT is \"$compat\": declare only the release that is actually built and tested"

# ---- licences --------------------------------------------------------------------------------------
bad=0
while IFS= read -r f; do
    grep -qE '^LICENSE[[:space:]]*=' "$f" || { fail "$(basename "$f") has no LICENSE"; bad=1; }
    if ! grep -qE '^LIC_FILES_CHKSUM[[:space:]]*=' "$f" && ! grep -qE 'inherit.*(packagegroup|core-image)' "$f"; then
        fail "$(basename "$f") has no LIC_FILES_CHKSUM"
        bad=1
    fi
done < <(find "$layer" -name '*.bb')
[ "$bad" -eq 0 ] && pass "every recipe declares LICENSE and LIC_FILES_CHKSUM"

# ---- files referenced by recipes exist -----------------------------------------------------------------
bad=0
while IFS= read -r f; do
    # Search path: the recipe's files/ directory plus any directory of this
    # repository the recipe adds with FILESEXTRAPATHS (${GNSS_UNO_Q_REPO}/...).
    search=("$(dirname "$f")/files")
    while IFS= read -r sub; do
        search+=("$repo/$sub")
    done < <(grep -E '^FILESEXTRAPATHS' "$f" | grep -oE '\$\{GNSS_UNO_Q_REPO\}/[A-Za-z0-9._/-]+' | sed 's#^\${GNSS_UNO_Q_REPO}/##')
    # Only SRC_URI entries; LIC_FILES_CHKSUM names files inside the fetched source.
    for name in $(grep -vE '^[[:space:]]*(#|LIC_FILES_CHKSUM)' "$f" | grep -oE 'file://[A-Za-z0-9._/%+-]+' | sed 's#file://##' | sort -u); do
        found=0
        for d in "${search[@]}"; do
            [ -e "$d/$name" ] && found=1 && break
        done
        [ "$found" -eq 1 ] || { fail "$(basename "$f"): SRC_URI file '$name' not found in: ${search[*]#"$repo"/}"; bad=1; }
    done
done < <(find "$layer" -name '*.bb')
[ "$bad" -eq 0 ] && pass "every file:// entry of SRC_URI exists"

# ---- shell files are LF and executable-ready ---------------------------------------------------------------
bad=0
while IFS= read -r f; do
    # Counted with tr: grep strips carriage returns on some Windows builds.
    if [ "$(tr -cd '\r' < "$f" | wc -c)" -gt 0 ]; then fail "CRLF line endings in ${f#"$repo"/}"; bad=1; fi
done < <(find "$layer" "$repo/kas" "$repo/scripts" "$repo/tests" -type f \
    \( -name '*.sh' -o -name '*.bb' -o -name '*.bbappend' -o -name '*.conf' -o -name '*.yml' -o -name '*.service' -o -name '*.rules' \
    -o -name 'gnss-sdr-preflight' -o -name 'gnss-mcu-flash' -o -name '*.default' -o -name '*.cfg' -o -name '*.py' \))
[ "$bad" -eq 0 ] && pass "no CRLF line endings in scripts, recipes or configuration"

# ---- generated dependency lists ------------------------------------------------------------------------------
if [ -s "$layer/recipes-mcu/arduino-router/arduino-router-go-mods.inc" ]; then
    pass "arduino-router Go modules are pinned (arduino-router-go-mods.inc)"
else
    pend "arduino-router-go-mods.inc not generated yet: arduino-router cannot be built offline until scripts/update-go-mods.sh has been run on the build host and its output committed"
fi

# ---- kas manifests ------------------------------------------------------------------------------------------------
echo "kas manifests"
"$python_bin" - "$repo" << 'EOF'
import re, sys
from pathlib import Path

repo = Path(sys.argv[1])
try:
    import yaml
except ImportError:
    print("  SKIP     PyYAML not installed: kas files not parsed (pip install pyyaml)")
    sys.exit(0)

fails = 0
def ok(msg): print("  PASS     " + msg)
def bad(msg):
    global fails
    fails += 1
    print("  FAIL     " + msg)

files = sorted((repo / "kas").rglob("*.yml"))
docs = {}
for f in files:
    try:
        docs[f] = yaml.safe_load(f.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        bad(f"{f.relative_to(repo)} is not valid YAML: {e}")
if len(docs) == len(files):
    ok(f"{len(files)} kas files are valid YAML")

pins = {}
for f, doc in docs.items():
    rel = f.relative_to(repo)
    if (doc.get("header") or {}).get("version") != 14:
        bad(f"{rel}: header.version must be 14 (the format the BSP's CI uses)")
    for inc in (doc.get("header") or {}).get("includes", []):
        if isinstance(inc, str) and not (repo / inc).is_file():
            bad(f"{rel}: included file {inc} does not exist")
    for name, r in (doc.get("repos") or {}).items():
        r = r or {}
        if "url" not in r:
            continue  # this repository itself
        commit = r.get("commit")
        if not commit or not re.fullmatch(r"[0-9a-f]{40}", str(commit)):
            bad(f"{rel}: repo '{name}' is not pinned to a full commit id (found: {commit!r})")
        else:
            pins[name] = (r["url"], r.get("branch", ""), commit)
        for pname, p in (r.get("patches") or {}).items():
            if "repo" not in p or "path" not in p:
                bad(f"{rel}: patch '{pname}' of '{name}' needs both repo and path")
if pins:
    ok(f"{len(pins)} external repositories, all pinned to a commit")

# revisions.lock must say the same as the kas files.
lock = repo / "manifests" / "revisions.lock"
if not lock.is_file():
    bad("manifests/revisions.lock is missing")
else:
    text = lock.read_text(encoding="utf-8")
    missing = [f"{n} {c[:12]}" for n, (_, _, c) in pins.items() if c not in text]
    if missing:
        bad("manifests/revisions.lock is out of date for: " + ", ".join(missing))
    else:
        ok("manifests/revisions.lock matches the kas pins")

prod = docs.get(repo / "kas" / "uno-q-gnss-sdr.yml") or {}
base = docs.get(repo / "kas" / "uno-q-upstream.yml") or {}
if base.get("machine") == "uno-q":
    ok('machine is "uno-q"')
else:
    bad(f"kas/uno-q-upstream.yml: machine is {base.get('machine')!r}, expected 'uno-q'")
extra = ((prod.get("local_conf_header") or {}).get("extra") or "")
if "empty-root-password" in extra or "allow-empty-password" in extra:
    bad("kas/uno-q-gnss-sdr.yml: the product image must not allow password-less root (that belongs in kas/include/debug.yml)")
else:
    ok("the product manifest does not enable password-less root")
sys.exit(1 if fails else 0)
EOF
[ "$?" -eq 0 ] || fails=$((fails + 1))

echo
if [ "$fails" -eq 0 ]; then
    echo "OK: static metadata checks passed ($pending pending item(s))."
    exit 0
fi
echo "FAILED: $fails check(s)."
exit 1
