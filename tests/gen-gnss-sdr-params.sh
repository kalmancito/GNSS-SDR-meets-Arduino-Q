#!/usr/bin/env bash
# Extract, from a GNSS-SDR source tree, every configuration name the code can
# read. The result is the reference test-configs.sh validates our .conf files
# against, so a typo or a parameter renamed upstream is caught without running
# the receiver.
#
# Usage: tests/gen-gnss-sdr-params.sh /path/to/gnss-sdr > tests/fixtures/gnss-sdr-<tag>-params.txt
#
# Output lines:
#   impl <Name>      implementation names known to the block factory
#   key <Role.name>  parameters read with a fixed role  (e.g. GNSS-SDR.internal_fs_sps)
#   suffix <name>    parameters read as  role + ".name"  (e.g. .sampling_frequency)
set -euo pipefail

src="${1:?usage: $0 /path/to/gnss-sdr}"
factory="$src/src/core/receiver/gnss_block_factory.cc"
[ -f "$factory" ] || { echo "error: $factory not found (not a GNSS-SDR source tree?)" >&2; exit 2; }

{
    # grep exits 1 (xargs: 123) for a batch of files without matches: not an error here.
    grep -ohE '"[A-Z][A-Za-z0-9_]*"' "$factory" | tr -d '"' | sed 's/^/impl /'
    find "$src/src" -type f \( -name '*.cc' -o -name '*.h' \) -print0 |
        { xargs -0 grep -ohE '"[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9_]+"' || true; } | tr -d '"' | sed 's/^/key /'
    find "$src/src" -type f \( -name '*.cc' -o -name '*.h' \) -print0 |
        { xargs -0 grep -ohE '"\.[A-Za-z0-9_]+"' || true; } | tr -d '".' | sed 's/^/suffix /'
} | LC_ALL=C sort -u
