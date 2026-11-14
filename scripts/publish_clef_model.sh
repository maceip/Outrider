#!/usr/bin/env bash
# Upload a packed CLEF .litertlm and its sha256 sidecar to the public bucket that
# proxyfor fetches from in the background (see proxyfor/src/clef/fetch.rs).
set -euo pipefail
MODEL="${1:?usage: publish_clef_model.sh <clef-flash.litertlm>}"
DEST="s3://outrider-public-models/clef/clef-flash.litertlm"
SUM="$(shasum -a 256 "$MODEL" | awk '{print $1}')"
aws s3 cp "$MODEL" "$DEST"
printf '%s  clef-flash.litertlm\n' "$SUM" | aws s3 cp - "$DEST.sha256" --content-type text/plain
curl -sfI "https://outrider-public-models.s3.eu-central-1.amazonaws.com/clef/clef-flash.litertlm.sha256" >/dev/null && echo "published $SUM"
