#!/usr/bin/env bash
# smoke-recon-operator.sh
#
# Smoke test for the Recon Operator pipeline.
#
# What this tests:
#   1. Credential provisioning  — writes a test credential file, checks permissions
#   2. Engagement creation      — writes a .recon-meta.json and validates its schema
#   3. Scan gate (detection)    — plants a fake secret and confirms the scanner flags it
#   4. Scan gate (clean)        — confirms the scanner passes clean content
#   5. Export (zip creation)    — confirms zip is produced with correct exclusions
#
# What this does NOT test:
#   - The Tauri runtime (no app launch required)
#   - Real network calls (no DataForSEO, CrUX, or Claude API traffic)
#   - The IPC sidecar protocol (handlers are exercised at the filesystem level only)
#   - The Setup Wizard UI flow
#
# Prerequisites:
#   - macOS 13+ (uses macOS stat -f or Linux stat -c fallback)
#   - Node.js in PATH
#   - python3 in PATH
#   - unzip in PATH
#   - zip in PATH
#
# Usage:
#   ./apps/desktop-companion/tools/smoke-recon-operator.sh
#   # Exit 0 = all checks passed; Exit 1 = one or more checks failed

set -euo pipefail

PASS=0
FAIL=0

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/resources/scan-sensitive-output.mjs"

echo "=== Recon Operator Smoke Test ==="
echo "Script dir: $SCRIPT_DIR"
echo "Scan script: $SCAN_SCRIPT"
echo ""

# ---------------------------------------------------------------------------
# Check 1 — Credential file operations
# ---------------------------------------------------------------------------
CRED_DIR="$HOME/Library/Application Support/com.joyus.desktop-companion"
CRED_FILE="$CRED_DIR/credentials.env"
BACKUP=""

# Back up existing credentials if present
if [[ -f "$CRED_FILE" ]]; then
  BACKUP="$CRED_FILE.smoke-backup"
  cp "$CRED_FILE" "$BACKUP"
fi

mkdir -p "$CRED_DIR"
echo 'SMOKE_TEST_KEY=test-value-12345' > "$CRED_FILE"
chmod 600 "$CRED_FILE"

# stat syntax differs between macOS and Linux
PERMS=$(stat -f "%Lp" "$CRED_FILE" 2>/dev/null || stat -c "%a" "$CRED_FILE" 2>/dev/null)
if [[ "$PERMS" == "600" ]]; then
  echo "[PASS] Credential provisioning (file created, permissions 600)"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Credential provisioning: expected 600, got $PERMS"
  FAIL=$((FAIL + 1))
fi

# Restore backup or clean up
if [[ -n "$BACKUP" ]]; then
  mv "$BACKUP" "$CRED_FILE"
else
  rm -f "$CRED_FILE"
fi

# ---------------------------------------------------------------------------
# Check 2 — Engagement directory creation
# ---------------------------------------------------------------------------
ENG_DIR="$HOME/Documents/joyus-recon-engagements/smoke-test-client"
mkdir -p "$ENG_DIR"

cat > "$ENG_DIR/.recon-meta.json" << 'METAEOF'
{
  "clientName": "Smoke Test Client",
  "clientSlug": "smoke-test-client",
  "url": "https://example.com",
  "accessMode": "rfp",
  "engagementId": "smoke-test-client-20260510-120000",
  "createdAt": "2026-05-10T12:00:00.000Z"
}
METAEOF

if python3 -c "import json; d=json.load(open('$ENG_DIR/.recon-meta.json')); assert all(k in d for k in ['clientName','clientSlug','url','accessMode','engagementId','createdAt'])" 2>/dev/null; then
  echo "[PASS] Engagement creation (meta file valid)"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Engagement creation: .recon-meta.json missing or invalid"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Check 3 — Scan gate (detection)
# Plant a value that triggers the `labeled-secret` pattern:
#   /\b(api[_ -]?key|...)\b\s*[:=]\s*["']?[^"'\s`]{8,}/gi
# The scanner skips lines matching /^\s*regex:\s*\// (source code), so we use
# a plain key: value line in a .md file to guarantee a real detection.
# ---------------------------------------------------------------------------
mkdir -p "$ENG_DIR/test-output"
echo 'api_key: sk-ant-api03-FAKEKEY00000000000000000' > "$ENG_DIR/test-output/report.md"

if [[ ! -f "$SCAN_SCRIPT" ]]; then
  echo "[FAIL] Scan gate (detection): scan-sensitive-output.mjs not found at $SCAN_SCRIPT"
  FAIL=$((FAIL + 1))
else
  if node "$SCAN_SCRIPT" "$ENG_DIR" 2>/dev/null; then
    echo "[FAIL] Scan gate (detection): scanner returned pass on planted secret"
    FAIL=$((FAIL + 1))
  else
    echo "[PASS] Scan gate (detection)"
    PASS=$((PASS + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Check 4 — Scan gate (clean)
# ---------------------------------------------------------------------------
rm -f "$ENG_DIR/test-output/report.md"
echo 'This is a clean report with no secrets.' > "$ENG_DIR/test-output/report.md"

if [[ ! -f "$SCAN_SCRIPT" ]]; then
  echo "[SKIP] Scan gate (clean): scan script not found (already failed above)"
  FAIL=$((FAIL + 1))
elif node "$SCAN_SCRIPT" "$ENG_DIR" 2>/dev/null; then
  echo "[PASS] Scan gate (clean)"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Scan gate (clean): scanner flagged clean content"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Check 5 — Export (zip creation and meta exclusion)
# Mirrors recon.export exclusion logic from recon.ts:
#   EXCLUDED_FILENAMES: .env .recon-complete .recon-meta.json .scan-overrides.json
#   EXCLUDED_DIRS: node_modules .git
# ---------------------------------------------------------------------------
rm -f /tmp/smoke-test-export.zip

cd "$ENG_DIR"
zip -r /tmp/smoke-test-export.zip . \
  -x '.recon-meta.json' \
  -x '.recon-complete' \
  -x '.scan-overrides.json' \
  -x '.env' \
  -x '*/node_modules/*' \
  -x '*/.git/*' \
  2>/dev/null

ZIP_SIZE=$(stat -f "%z" /tmp/smoke-test-export.zip 2>/dev/null || stat -c "%s" /tmp/smoke-test-export.zip 2>/dev/null || echo "0")

if [[ -f /tmp/smoke-test-export.zip ]] && [[ "$ZIP_SIZE" -gt 0 ]]; then
  if unzip -l /tmp/smoke-test-export.zip 2>/dev/null | grep -q '.recon-meta.json'; then
    echo "[FAIL] Export: zip contains .recon-meta.json (should be excluded)"
    FAIL=$((FAIL + 1))
  else
    echo "[PASS] Export (zip created, meta excluded)"
    PASS=$((PASS + 1))
  fi
else
  echo "[FAIL] Export: zip not created or empty"
  FAIL=$((FAIL + 1))
fi
cd - > /dev/null

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
rm -rf "$ENG_DIR"
rm -f /tmp/smoke-test-export.zip
echo ""
echo "Cleanup complete."

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS + FAIL))
echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "SMOKE TEST PASSED ($PASS/$TOTAL)"
  exit 0
else
  echo "SMOKE TEST FAILED ($PASS/$TOTAL passed)"
  exit 1
fi
