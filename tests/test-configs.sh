#!/usr/bin/env bash
# Validate the GNSS-SDR profiles shipped in the image against the pinned
# GNSS-SDR release. Static check: syntax, parameter and implementation names,
# and the product's own rules. It does not run the receiver.
#
# Usage: tests/test-configs.sh [file.conf ...]     (default: all shipped profiles)
#
#   GNSS_SDR_SRC=/path/to/gnss-sdr   regenerate the reference from that source
#                                    tree (must be checked out at the pinned tag)
#                                    instead of using the committed snapshot.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
reference="$here/fixtures/gnss-sdr-v0.0.22-params.txt"

python_bin="$(command -v python3 || command -v python || true)"
[ -n "$python_bin" ] || { echo "error: python3 not found" >&2; exit 2; }

if [ -n "${GNSS_SDR_SRC:-}" ]; then
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    "$here/gen-gnss-sdr-params.sh" "$GNSS_SDR_SRC" > "$tmp"
    if ! diff -q "$tmp" "$reference" > /dev/null; then
        echo "note: $GNSS_SDR_SRC differs from the committed snapshot ($reference)." >&2
        echo "      If the pinned GNSS-SDR release changed, regenerate the snapshot." >&2
    fi
    reference="$tmp"
fi

if [ "$#" -eq 0 ]; then
    set -- "$repo"/meta-gnss-uno-q/recipes-apps/gnss-config/files/*.conf
fi

exec "$python_bin" "$here/check_gnss_conf.py" --reference "$reference" "$@"
