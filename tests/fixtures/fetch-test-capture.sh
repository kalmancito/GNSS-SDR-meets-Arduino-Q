#!/usr/bin/env bash
# Download and verify the public GPS L1 C/A test capture used by the file
# profile. See README.md in this directory for what it is.
#
#   tests/fixtures/fetch-test-capture.sh [destination-dir]
#
# Default destination: tests/fixtures/data (ignored by git). On the board use
# /var/lib/gnss-sdr/captures. Needs about 2.8 GB free while extracting
# (1.15 GB archive + 1.6 GB capture); the archive is deleted afterwards.
set -euo pipefail

URL="https://sourceforge.net/projects/gnss-sdr/files/data/2013_04_04_GNSS_SIGNAL_at_CTTC_SPAIN.tar.gz/download"
ARCHIVE="2013_04_04_GNSS_SIGNAL_at_CTTC_SPAIN.tar.gz"
ARCHIVE_MD5="bc21964ad115e4b60c00893411f35c87"   # as published on SourceForge
ARCHIVE_BYTES=1150716878
CAPTURE="2013_04_04_GNSS_SIGNAL_at_CTTC_SPAIN.dat"
CAPTURE_BYTES=1600000000                          # 400e6 complex samples x 4 bytes

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${1:-$here/data}"
mkdir -p "$dest"
cd "$dest"

die() { echo "error: $*" >&2; exit 1; }
size_of() { stat -c %s "$1" 2> /dev/null || wc -c < "$1"; }

if [ -f "$CAPTURE" ] && [ "$(size_of "$CAPTURE")" -eq "$CAPTURE_BYTES" ]; then
    echo "$dest/$CAPTURE already present ($CAPTURE_BYTES bytes)."
    sha256sum "$CAPTURE"
    exit 0
fi

free_kb=$(df -Pk . | awk 'NR==2 {print $4}')
[ "$free_kb" -ge 2900000 ] || die "not enough free space in $dest (need about 2.8 GB, have $((free_kb / 1024)) MB)."

echo "Downloading $ARCHIVE ($((ARCHIVE_BYTES / 1000000)) MB)..."
curl -fL --retry 3 -C - -o "$ARCHIVE" "$URL"

[ "$(size_of "$ARCHIVE")" -eq "$ARCHIVE_BYTES" ] || die "archive size is $(size_of "$ARCHIVE") bytes, expected $ARCHIVE_BYTES."
echo "$ARCHIVE_MD5  $ARCHIVE" | md5sum -c - || die "archive checksum mismatch: do not use this file."

echo "Extracting..."
tar -xzf "$ARCHIVE"
found="$(find . -name "$CAPTURE" -type f | head -n 1)"
[ -n "$found" ] || die "$CAPTURE not found inside the archive."
[ "$found" = "./$CAPTURE" ] || mv "$found" "./$CAPTURE"
[ "$(size_of "$CAPTURE")" -eq "$CAPTURE_BYTES" ] || die "capture size is $(size_of "$CAPTURE") bytes, expected $CAPTURE_BYTES."
rm -f "$ARCHIVE"

echo "Ready: $dest/$CAPTURE"
echo "sha256 (record it in docs/validation-report.md with your results):"
sha256sum "$CAPTURE"
