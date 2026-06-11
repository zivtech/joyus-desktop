# Desktop Application Smoke Test Checklist

**Feature**: 004 — Desktop Application Shell
**Version**: WP15 — Integration Testing & Polish

This checklist must be completed on both macOS and Windows before shipping. Mark each test Pass (P), Fail (F), or Skip (S/A for not applicable to platform). Record notes for any failure.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| P | Pass |
| F | Fail (record error details in Notes) |
| S | Skip / Not applicable on this platform |

---

## Checklist

| # | Test | Pass Criteria | macOS Result | Windows Result | Notes |
|---|------|---------------|:------------:|:--------------:|-------|
| **Install** |
| 1.1 | Download installer | Installer file downloads without error | | | |
| 1.2 | Run installer | Installer completes without UAC / Gatekeeper block | | | |
| 1.3 | App appears | App appears in Applications (macOS) or Start Menu (Windows) | | | |
| 1.4 | Launch from install location | App opens on first launch without crash | | | |
| **First Launch — Onboarding** |
| 2.1 | Onboarding wizard appears | Onboarding UI shown on first launch (not dashboard) | | | |
| 2.2 | Auth step completes | Token entry accepted; no error toast | | | |
| 2.3 | MCP servers registered | At least one server shown as "running" after onboarding | | | |
| 2.4 | Skills synced | Skills list populated after onboarding | | | |
| 2.5 | `onboarding_complete` flag set | Re-launching app goes directly to dashboard (not onboarding) | | | |
| **System Tray** |
| 3.1 | Tray icon appears | Icon visible in system tray / menu bar | | | |
| 3.2 | Context menu opens | Right-click / click shows menu with expected items | | | |
| 3.3 | "Open Dashboard" works | Dashboard window opens | | | |
| 3.4 | "Quit" from tray works | App quits; tray icon disappears | | | |
| **Dashboard — Page Navigation** |
| 4.1 | Overview page loads | Overview page displays summary data | | | |
| 4.2 | Servers page loads | Server list displays registered MCP servers | | | |
| 4.3 | Skills page loads | Skills list displays synced skills | | | |
| 4.4 | Governance page loads | Governance mode and decisions displayed | | | |
| 4.5 | Analytics page loads | Usage stats rendered without error | | | |
| 4.6 | Settings page loads | Settings form renders; no blank page | | | |
| **Server Management** |
| 5.1 | Start a server | Server transitions to "running" state in UI | | | |
| 5.2 | Stop a server | Server transitions to "stopped" state in UI | | | |
| 5.3 | Restart a server | Server restarts; restartCount increments | | | |
| 5.4 | Server status updates in real time | Crash or change reflected in dashboard within 5 seconds | | | |
| **Skill Sync** |
| 6.1 | Manual sync trigger | Sync completes; "Last synced" timestamp updates | | | |
| 6.2 | Skills list updates after sync | New/updated skills appear without page reload | | | |
| 6.3 | Sync error handled gracefully | Error toast shown; app does not crash | | | |
| **Auto-Start** |
| 7.1 | App registered for auto-start | App starts automatically after system reboot | | | |
| 7.2 | Post-reboot state | Dashboard loads (not onboarding) after reboot | | | |
| 7.3 | Tray icon present after reboot | Icon visible without manual launch | | | |
| **Update** |
| 8.1 | Update notification appears | Update banner/toast shown when new version available | | | |
| 8.2 | Update installs | Update completes; new version shown in Settings | | | |
| **Quit and Re-Launch** |
| 9.1 | Quit from tray | All processes (sidecar + renderer) terminate cleanly | | | |
| 9.2 | Re-launch opens dashboard | Dashboard shown (not onboarding wizard) | | | |
| 9.3 | State preserved across quit | Server status and settings persisted | | | |
| **Security — SC-010: `.mcp.json` Tampering** |
| 10.1 | Locate `.mcp.json` | File found at expected path (e.g., `~/.claude/.mcp.json`) | | | |
| 10.2 | Delete managed entries | Manually delete the `joyus-managed` section from `.mcp.json` | | | |
| 10.3 | Re-launch app | App detects missing managed entries on startup | | | |
| 10.4 | Managed entries restored | Re-launched app rewrites managed MCP entries back into `.mcp.json` | | | |
| 10.5 | Servers functional after restore | MCP servers start and respond after restore | | | |

---

## Sign-Off

| Field | Value |
|-------|-------|
| Tester name | |
| macOS version | |
| Windows version | |
| App version | |
| Date | |
| Overall result | |

---

## Notes

Record any failures, observations, or environment-specific issues here.

### macOS Notes

_(blank — fill in during testing)_

### Windows Notes

_(blank — fill in during testing)_

---

## References

- SC-006: Real-time server state updates within 5 seconds
- SC-010: `.mcp.json` managed entry restoration on relaunch
- Feature spec: `kitty-specs/004-desktop-application-shell/spec.md`
