#!/bin/bash
# Joyus Desktop — macOS uninstall cleanup
#
# Run this script after dragging Joyus Desktop to Trash to remove all user data.
# If you want to keep your data for a future reinstall, skip this script.
#
# Usage:
#   bash /path/to/uninstall-cleanup.sh [--force]
#
# --force  Skip the confirmation prompt

set -euo pipefail

APP_ID="com.joyus.desktop-companion"
SKILL_CACHE="$HOME/.claude/.skill-sync-cache"
APP_DATA="$HOME/Library/Application Support/$APP_ID"
MANAGED_DIR="$HOME/.claude/.joyus-managed"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/${APP_ID}.plist"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

echo "Joyus Desktop — Uninstall Cleanup"
echo ""
echo "This will remove:"
[[ -d "$SKILL_CACHE" ]]  && echo "  - Skill-sync cache:   $SKILL_CACHE"
[[ -d "$APP_DATA" ]]     && echo "  - App data:           $APP_DATA"
[[ -d "$MANAGED_DIR" ]]  && echo "  - Managed MCP config: $MANAGED_DIR"
[[ -f "$LAUNCH_AGENT" ]] && echo "  - LaunchAgent:        $LAUNCH_AGENT"
echo ""

if [[ "$FORCE" != true ]]; then
  read -rp "Continue? [y/N] " confirm
  if [[ "$confirm" != [yY] ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Unload LaunchAgent if present
if [[ -f "$LAUNCH_AGENT" ]]; then
  launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
  rm -f "$LAUNCH_AGENT"
  echo "Removed LaunchAgent"
fi

# Remove data directories
[[ -d "$SKILL_CACHE" ]]  && rm -rf "$SKILL_CACHE"  && echo "Removed skill-sync cache"
[[ -d "$APP_DATA" ]]     && rm -rf "$APP_DATA"      && echo "Removed app data"
[[ -d "$MANAGED_DIR" ]]  && rm -rf "$MANAGED_DIR"   && echo "Removed managed MCP config"

echo ""
echo "Cleanup complete. You can now empty the Trash to finish uninstalling."
