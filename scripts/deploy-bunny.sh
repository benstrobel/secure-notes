#!/usr/bin/env bash
# Mirrors a local directory (the Vite build output) to a bunny.net Edge
# Storage zone: wipes whatever's there, then uploads everything fresh.
# Safe because this storage zone only ever holds generated build output,
# nothing hand-placed or user-uploaded lives alongside it.
#
# Required env: BUNNY_STORAGE_HOSTNAME, BUNNY_STORAGE_ZONE, BUNNY_STORAGE_ACCESS_KEY
# Usage: deploy-bunny.sh <local-dir>

set -euo pipefail

DIST_DIR="${1:?Usage: deploy-bunny.sh <local-dir>}"
: "${BUNNY_STORAGE_HOSTNAME:?Set BUNNY_STORAGE_HOSTNAME (terraform output storage_hostname)}"
: "${BUNNY_STORAGE_ZONE:?Set BUNNY_STORAGE_ZONE (terraform output storage_zone_name)}"
: "${BUNNY_STORAGE_ACCESS_KEY:?Set BUNNY_STORAGE_ACCESS_KEY (terraform output storage_access_key)}"

if [ ! -d "$DIST_DIR" ]; then
  echo "error: '$DIST_DIR' is not a directory" >&2
  exit 1
fi

BASE_URL="https://${BUNNY_STORAGE_HOSTNAME}/${BUNNY_STORAGE_ZONE}"

content_type_for() {
  case "$1" in
    *.html) echo "text/html; charset=utf-8" ;;
    *.js|*.mjs) echo "application/javascript" ;;
    *.css) echo "text/css" ;;
    *.json) echo "application/json" ;;
    *.webmanifest) echo "application/manifest+json" ;;
    *.svg) echo "image/svg+xml" ;;
    *.png) echo "image/png" ;;
    *.ico) echo "image/x-icon" ;;
    *.woff2) echo "font/woff2" ;;
    *.txt) echo "text/plain; charset=utf-8" ;;
    *.xml) echo "application/xml" ;;
    *) echo "application/octet-stream" ;;
  esac
}

echo "== Clearing existing files in storage zone '${BUNNY_STORAGE_ZONE}' =="
existing_json="$(curl -sf -H "AccessKey: ${BUNNY_STORAGE_ACCESS_KEY}" "${BASE_URL}/" || echo "[]")"
echo "${existing_json}" | jq -r '.[]? | "\(.ObjectName)\t\(.IsDirectory)"' | while IFS=$'\t' read -r name is_dir; do
  [ -z "$name" ] && continue
  # Bunny's storage API deletes a directory recursively only when the path
  # has a trailing slash -- without it, deleting a directory entry (e.g.
  # Vite's "assets" folder) fails since there's no file by that exact name.
  path="$name"
  [ "$is_dir" = "true" ] && path="${name}/"
  echo "  deleting ${path}"
  curl -sf -X DELETE -H "AccessKey: ${BUNNY_STORAGE_ACCESS_KEY}" "${BASE_URL}/${path}" >/dev/null
done

echo "== Uploading ${DIST_DIR} =="
( cd "$DIST_DIR" && find . -type f ) | sed 's|^\./||' | while IFS= read -r rel; do
  ct="$(content_type_for "$rel")"
  echo "  uploading ${rel} (${ct})"
  curl -sf -X PUT \
    -H "AccessKey: ${BUNNY_STORAGE_ACCESS_KEY}" \
    -H "Content-Type: ${ct}" \
    --data-binary "@${DIST_DIR}/${rel}" \
    "${BASE_URL}/${rel}" >/dev/null
done

echo "== Done =="
