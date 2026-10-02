#!/usr/bin/env bash
# fetch-public-corpora.sh — download the public human corpora the deterministic gate is budgeted on
# (calibration/human-fp-budget.mjs), pinned to fixed versions and checked file by file against
# calibration/public-corpora.sha256. PUBLIC data only:
#   18F blog posts 2015-2021   github.com/18F/18f.gsa.gov @ 292605ab (content/posts, 429 files, CC0 / US gov work)
#   Python PEPs                github.com/python/peps @ f2f542d (576 files, public domain / CC0)
#   18 IETF RFCs               www.rfc-editor.org/rfc/rfcNNNN.txt
#   20 Newsgroups (by date)    qwone.com/~jason/20Newsgroups/20news-bydate.tar.gz (1992-93 Usenet)
#
# Usage:  bash calibration/fetch-public-corpora.sh            # into $VOICE_CORPORA or ~/.cache/voice-system/corpora
#         VOICE_CORPORA=/some/dir bash calibration/fetch-public-corpora.sh
# Idempotent: a set that already verifies is not downloaded again. Exit non-zero on any checksum mismatch.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
MANIFEST="$HERE/public-corpora.sha256"
DEST=${VOICE_CORPORA:-$HOME/.cache/voice-system/corpora}
F18_REPO=18F/18f.gsa.gov;   F18_SHA=292605ab095af8e70e2087aca63c2319ce892a4c
PEPS_REPO=python/peps;      PEPS_SHA=f2f542d54442d7304b95ff6652ec89b6e6a2d45b
NG_URL=http://qwone.com/~jason/20Newsgroups/20news-bydate.tar.gz
RFCS="1122 1958 2775 3439 3552 3935 4101 4677 5218 5505 6709 6973 7258 7282 7764 8558 8799 8890"

if command -v sha256sum >/dev/null 2>&1; then SHA="sha256sum"; else SHA="shasum -a 256"; fi
mkdir -p "$DEST"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
dl() { curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1"; }

# verify <prefix>: check every manifest line whose path starts with <prefix> (quietly); 0 = all present and match
verify() { (cd "$DEST" && grep -E "  $1" "$MANIFEST" | $SHA -c --quiet - >/dev/null 2>&1); }

if verify 'f18/'; then echo "18F: ok (cached)"; else
  # file by file from the pinned commit (the repo tarball carries the whole site's images)
  echo "18F: fetching 429 posts from $F18_REPO@${F18_SHA:0:8}"
  mkdir -p "$DEST/f18"
  grep -E '  f18/' "$MANIFEST" | awk '{print $2}' | sed 's#^f18/##' \
    | xargs -P 8 -I{} curl -fsSL --retry 3 --retry-delay 2 -o "$DEST/f18/{}" "https://raw.githubusercontent.com/$F18_REPO/$F18_SHA/content/posts/{}"
  verify 'f18/' || { echo "18F: checksum mismatch" >&2; exit 1; }
  echo "18F: ok"
fi

if verify 'pep/'; then echo "PEPs: ok (cached)"; else
  echo "PEPs: fetching $PEPS_REPO@${PEPS_SHA:0:8}"
  dl "https://codeload.github.com/$PEPS_REPO/tar.gz/$PEPS_SHA" "$tmp/peps.tgz"
  tar -xzf "$tmp/peps.tgz" -C "$tmp"
  mkdir -p "$DEST/pep"
  grep -E '  pep/' "$MANIFEST" | awk '{print $2}' | sed 's#^pep/##' | while read -r f; do cp "$tmp/peps-$PEPS_SHA/$f" "$DEST/pep/$f"; done
  verify 'pep/' || { echo "PEPs: checksum mismatch" >&2; exit 1; }
  echo "PEPs: ok"
fi

if verify 'rfc/'; then echo "RFCs: ok (cached)"; else
  echo "RFCs: fetching 18 from rfc-editor.org"
  mkdir -p "$DEST/rfc"
  for n in $RFCS; do dl "https://www.rfc-editor.org/rfc/rfc$n.txt" "$DEST/rfc/$n.txt"; done
  verify 'rfc/' || { echo "RFCs: checksum mismatch" >&2; exit 1; }
  echo "RFCs: ok"
fi

if verify '20news-bydate.tar.gz' && [ -d "$DEST/20news-bydate-train" ] && [ -d "$DEST/20news-bydate-test" ]; then echo "20 Newsgroups: ok (cached)"; else
  echo "20 Newsgroups: fetching $NG_URL"
  dl "$NG_URL" "$DEST/20news-bydate.tar.gz"
  verify '20news-bydate.tar.gz' || { echo "20 Newsgroups: checksum mismatch" >&2; exit 1; }
  tar -xzf "$DEST/20news-bydate.tar.gz" -C "$DEST"
  echo "20 Newsgroups: ok"
fi
echo "corpora ready in $DEST"
