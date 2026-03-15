#!/usr/bin/env bash
# generate-update-manifest.sh
#
# Reads Tauri .sig files from the build output and generates the update manifest
# JSON consumed by the Tauri auto-updater.
#
# Required environment variables:
#   GITHUB_TOKEN   — token with release read access
#   RELEASE_TAG    — e.g. "v1.2.0"
#   REPO           — e.g. "org/repo"
#
# Output: update-manifest.json in the current directory

set -euo pipefail

VERSION="${RELEASE_TAG#v}"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
ARTIFACTS_DIR="release-artifacts/renamed"
RELEASE_BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"

# ── Helper: read .sig file content ──────────────────────────────────────────
read_sig() {
  local sig_file="$1"
  if [ ! -f "$sig_file" ]; then
    echo "ERROR: signature file not found: $sig_file" >&2
    exit 1
  fi
  cat "$sig_file"
}

# ── Collect signatures ───────────────────────────────────────────────────────
DARWIN_UNIVERSAL_TARGZ="joyus-desktop-companion-${VERSION}-darwin-universal.tar.gz"
DARWIN_UNIVERSAL_SIG="${ARTIFACTS_DIR}/${DARWIN_UNIVERSAL_TARGZ}.sig"

WINDOWS_X64_ZIP="joyus-desktop-companion-${VERSION}-windows-x86_64.zip"
WINDOWS_X64_SIG="${ARTIFACTS_DIR}/${WINDOWS_X64_ZIP}.sig"

SIG_DARWIN_UNIVERSAL="$(read_sig "$DARWIN_UNIVERSAL_SIG")"
SIG_WINDOWS_X64="$(read_sig "$WINDOWS_X64_SIG")"

# ── Fetch release notes from git tag message ─────────────────────────────────
NOTES=""
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null; then
  NOTES="$(git tag -l --format='%(contents)' "$RELEASE_TAG" 2>/dev/null || true)"
fi
# Escape for JSON
NOTES_JSON="$(printf '%s' "$NOTES" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')"

# ── Build manifest ───────────────────────────────────────────────────────────
cat > update-manifest.json <<EOF
{
  "version": "${VERSION}",
  "notes": ${NOTES_JSON},
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIG_DARWIN_UNIVERSAL}",
      "url": "${RELEASE_BASE_URL}/${DARWIN_UNIVERSAL_TARGZ}"
    },
    "darwin-x86_64": {
      "signature": "${SIG_DARWIN_UNIVERSAL}",
      "url": "${RELEASE_BASE_URL}/${DARWIN_UNIVERSAL_TARGZ}"
    },
    "windows-x86_64": {
      "signature": "${SIG_WINDOWS_X64}",
      "url": "${RELEASE_BASE_URL}/${WINDOWS_X64_ZIP}"
    }
  }
}
EOF

echo "Generated update-manifest.json for version ${VERSION}"
python3 -m json.tool update-manifest.json > /dev/null \
  && echo "Manifest JSON is valid." \
  || (echo "ERROR: Manifest JSON is invalid!" >&2 && exit 1)
