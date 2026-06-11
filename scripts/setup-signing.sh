#!/usr/bin/env bash
set -euo pipefail

# Joyus Desktop — Signing & Updater Setup
# Run this after installing Rust and Tauri CLI.
#
# What this script does:
#   1. Verifies Rust + Tauri CLI are installed
#   2. Generates the Tauri updater keypair (if not already present)
#   3. Prints instructions for GitHub Secrets configuration

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

KEYPAIR_DIR="${HOME}/.tauri"
KEY_FILE="${KEYPAIR_DIR}/joyus-desktop.key"
PUBKEY_FILE="${KEYPAIR_DIR}/joyus-desktop.key.pub"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Joyus Desktop — Signing & Updater Setup"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────────────────

echo "Step 1: Checking prerequisites..."
echo ""

MISSING=0

if ! command -v cargo &>/dev/null; then
  echo -e "  ${RED}✗${NC} cargo not found"
  echo "    Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  MISSING=1
else
  echo -e "  ${GREEN}✓${NC} cargo $(cargo --version | cut -d' ' -f2)"
fi

if ! command -v cargo-tauri &>/dev/null && ! cargo tauri --version &>/dev/null 2>&1; then
  echo -e "  ${YELLOW}!${NC} tauri-cli not installed — will install now"
  cargo install tauri-cli
else
  echo -e "  ${GREEN}✓${NC} tauri-cli installed"
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo -e "${RED}Prerequisites missing. Install them and re-run.${NC}"
  exit 1
fi

echo ""

# ── Step 2: Generate updater keypair ─────────────────────────────────────────

echo "Step 2: Generating Tauri updater keypair..."
echo ""

if [ -f "$KEY_FILE" ]; then
  echo -e "  ${GREEN}✓${NC} Keypair already exists at ${KEY_FILE}"
  echo "    Public key: $(cat "$PUBKEY_FILE")"
else
  mkdir -p "$KEYPAIR_DIR"
  echo "  Generating keypair (you'll be prompted for a password)..."
  echo ""
  cargo tauri signer generate -w "$KEY_FILE"
  echo ""
  echo -e "  ${GREEN}✓${NC} Keypair saved:"
  echo "    Private key: ${KEY_FILE}"
  echo "    Public key:  ${PUBKEY_FILE}"
fi

echo ""

# ── Step 3: Print GitHub Secrets instructions ────────────────────────────────

echo "═══════════════════════════════════════════════════"
echo "  Step 3: GitHub Secrets Configuration"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Set the following secrets on your GitHub repository:"
echo "(Settings → Secrets and variables → Actions → New repository secret)"
echo ""
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ UPDATER SIGNING (required for auto-updates)                     │"
echo "├─────────────────────────────────────────────────────────────────┤"
echo "│ TAURI_SIGNING_PRIVATE_KEY          contents of ${KEY_FILE}      │"
echo "│ TAURI_SIGNING_PRIVATE_KEY_PASSWORD  password you just chose     │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo ""
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ macOS SIGNING (required for distribution)                       │"
echo "├─────────────────────────────────────────────────────────────────┤"
echo "│ APPLE_CERTIFICATE           base64 -i /path/to/cert.p12        │"
echo "│ APPLE_CERTIFICATE_PASSWORD  password for the .p12 file         │"
echo "│ APPLE_ID                    Apple Developer account email       │"
echo "│ APPLE_PASSWORD              App-specific password (appleid.com) │"
echo "│ APPLE_TEAM_ID               10-char Team ID from Dev portal    │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo ""
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ WINDOWS SIGNING (required for distribution)                     │"
echo "├─────────────────────────────────────────────────────────────────┤"
echo "│ WINDOWS_CERTIFICATE           base64 of .pfx cert file         │"
echo "│ WINDOWS_CERTIFICATE_PASSWORD   password for the .pfx           │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo ""

if [ -f "$PUBKEY_FILE" ]; then
  echo "┌─────────────────────────────────────────────────────────────────┐"
  echo "│ ENVIRONMENT VARIABLE (set in repo or CI)                        │"
  echo "├─────────────────────────────────────────────────────────────────┤"
  echo "│ TAURI_UPDATER_PUBKEY=$(cat "$PUBKEY_FILE")"
  echo "└─────────────────────────────────────────────────────────────────┘"
  echo ""
fi

echo "═══════════════════════════════════════════════════"
echo "  Next Steps"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  1. Set the GitHub Secrets above"
echo "  2. Install Rust locally if not done: rustup show"
echo "  3. Test local unsigned build:"
echo "       cd apps/desktop-companion"
echo "       pnpm build:sidecar && pnpm download:node"
echo "       cargo tauri build"
echo "  4. Push a tag (v0.1.0) to trigger the signed release workflow"
echo ""
