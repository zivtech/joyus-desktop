# First Platform Test — Smoke Checklist

**Target**: Week of 2026-05-05  
**Scope**: Unsigned macOS dev build, mock control plane, core flows only  
**Prerequisites**: Rust installed, `pnpm install` complete

---

## Pre-Test Setup

| # | Step | Command / Action | Expected |
|---|------|-----------------|----------|
| 0.1 | Start mock control plane | `node scripts/mock-control-plane.mjs` | Server listening on :9400 |
| 0.2 | Set env vars | Export `JOYUS_API_URL=http://localhost:9400` and `JOYUS_API_TOKEN=test-token` | — |
| 0.3 | Build sidecar | `pnpm --filter @joyus/desktop-companion build:sidecar` | `binaries/sidecar-main.mjs` exists |
| 0.4 | Download node binary | `pnpm --filter @joyus/desktop-companion download:node` | Platform-specific node binary in `binaries/` |
| 0.5 | Build app (unsigned) | `cd apps/desktop-companion && cargo tauri build` | `.app` produced in `target/release/bundle/macos/` |
| 0.6 | Remove quarantine (if blocked) | `xattr -dr com.apple.quarantine "target/release/bundle/macos/Joyus Desktop.app"` | App launchable |

---

## Core Flow Tests

| # | Test | Steps | Pass Criteria | Result | Notes |
|---|------|-------|---------------|:------:|-------|
| **Launch & Tray** |
| 1.1 | App launches | Double-click the `.app` | Window or tray icon appears, no crash | | |
| 1.2 | Tray icon visible | Check menu bar | Joyus icon present | | |
| 1.3 | Tray menu works | Click tray icon | Context menu with "Open Dashboard", "Quit" | | |
| **Sidecar & MCP** |
| 2.1 | Sidecar starts | Watch app logs / mock server output | Sidecar process spawns, MCP tools/call requests arrive at mock | | |
| 2.2 | Health check | From dashboard or `curl localhost:9400/health` | Returns `{"status":"ok","mode":"mock"}` | | |
| 2.3 | Server list | Open Servers page in dashboard | At least one MCP server listed | | |
| **Policy Decisions** |
| 3.1 | Policy request sent | Trigger any action that requires policy | Mock logs `tools/call → verify_before_action` | | |
| 3.2 | Allow decision accepted | Observe app behavior | Action proceeds (no policy-denied error) | | |
| 3.3 | Token received | Check app logs | Token with valid JWT structure accepted | | |
| **Skill Sync** |
| 4.1 | Trigger sync | Click sync button or run `trigger_sync` | Sync request sent to sidecar | | |
| 4.2 | Skills list populated | Open Skills page | Skills display (or empty-state if no bundle configured) | | |
| **Session & Workspace** |
| 5.1 | Session registers | Launch app with `JOYUS_TENANT_ID=test-tenant` and `JOYUS_SESSION_ID=test-session` | Mock receives requests with correct tenant/session | | |
| 5.2 | Workspace request | If workspace flow is triggered | Mock logs `tools/call → request_workspace`, returns workspace record | | |
| **Shutdown** |
| 6.1 | Quit from tray | Click "Quit" in tray menu | App exits cleanly, sidecar terminates, no orphan processes | | |
| 6.2 | Re-launch | Open app again | App starts fresh, connects to mock again | | |

---

## Known Acceptable Failures (for this test)

These are **not** blockers for the first test:

- Gatekeeper warning (unsigned build — use xattr workaround)
- Updater check fails (no `releases.joyus.dev` endpoint yet)
- Autostart toggle has no visible OS-level effect (plugin works, but needs signed install to register properly)
- Site Manager page is a stub (feature 007 not in test scope)
- No Windows build available

---

## Environment Variables Reference

```bash
# Required for control plane connection
export JOYUS_API_URL=http://localhost:9400
export JOYUS_API_TOKEN=test-token

# Optional — enriches mock request context
export JOYUS_TENANT_ID=test-tenant
export JOYUS_SESSION_ID=test-session-001

# Optional — disable updater check for testing
export TAURI_UPDATER_PUBKEY=skip
```

---

## Reporting

Record results in this checklist and attach:
1. Console output from the mock control plane (shows all requests received)
2. App logs (if available via Console.app or `log stream --process "Joyus Desktop"`)
3. Screenshots of any failures

File issues for failures not listed in "Known Acceptable Failures" above.
