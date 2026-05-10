---
work_package_id: WP07
title: Phase 1 Integration
dependencies:
- WP01
- WP02
- WP03
- WP04
- WP05
- WP06
requirement_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts generated on main. During implementation, this WP may branch from a dependency-specific base. Completed changes must merge back into main.
subtasks:
- T029
- T030
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/tools/
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/tools/smoke-recon-operator.sh
- apps/desktop-companion/docs/recon-operator-setup-runbook.md
tags: []
wp_code: WP07
---

# WP07: Phase 1 Integration

## Overview

Validate that all Recon Operator WPs (01–06) wire together correctly on a clean install, and produce a human-readable runbook for Alex to use when onboarding Aaron. This WP is the Phase 1 MVP gate: smoke tests pass, runbook covers every Aaron-facing step, and the dogfood DMG is ready to hand off.

## Codebase Pattern

Tooling scripts live in `apps/desktop-companion/tools/`. Check for existing shell scripts to match style (shebang, error handling, `set -euo pipefail`). Documentation lives in `apps/desktop-companion/docs/` (check for existing docs to confirm path convention).

## Subtasks

### T029 — Create smoke test script

Create `apps/desktop-companion/tools/smoke-recon-operator.sh`.

**Requirements**: bash, `set -euo pipefail`. No real Recon execution. No network calls. Cleans up after itself. Exits 0 on all-pass, 1 on any failure. Prints `[PASS]` / `[FAIL]` per check.

**Check 1 — Credential provisioning**:
1. Call the sidecar's credential save endpoint with a test key (`SMOKE_TEST_KEY`) and a dummy value. Use `node` to invoke the sidecar directly (or via a thin CLI shim if one exists — check `apps/desktop-companion/src/sidecar/cli.ts` or equivalent).
2. Call `credentials.list` and verify `SMOKE_TEST_KEY` appears with `isSet: true`.
3. Verify the stored file exists at the expected path and is not world-readable (`stat` mode check: no group/other read bits).
4. Call `credentials.delete` (or overwrite) to clean up.
5. Print: `[PASS] Credential provisioning` or `[FAIL] Credential provisioning: <reason>`.

**Check 2 — Engagement creation**:
1. Call `recon.create` with `{ clientName: "Smoke Test Client", url: "https://example.com", accessMode: "rfp" }`.
2. Verify the returned `engagementDir` exists.
3. Verify `.recon-meta.json` exists inside `engagementDir` and contains valid JSON with required fields (`clientName`, `clientSlug`, `url`, `accessMode`, `engagementId`, `createdAt`).
4. Print: `[PASS] Engagement creation` or `[FAIL] Engagement creation: <reason>`.
5. Store `engagementDir` for use in subsequent checks.

**Check 3 — Scan gate (detection)**:
1. Plant a fake secret in the engagement directory: write `test-output/report.md` containing a pattern that `scan-sensitive-output.mjs` must detect (e.g., a string matching `sk-ant-` or `DATAFORSEO` depending on the scanner's rule set — check `resources/scan-sensitive-output.mjs` for actual patterns).
2. Call `recon.scan` against the engagement directory.
3. Assert `passed === false` and `findings.length > 0`. Assert the finding references `test-output/report.md`.
4. Print: `[PASS] Scan gate (detection)` or `[FAIL] Scan gate (detection): <reason>`.

**Check 4 — Scan gate (clean)**:
1. Remove the planted file from check 3.
2. Call `recon.scan` again.
3. Assert `passed === true` and `findings.length === 0`.
4. Print: `[PASS] Scan gate (clean)` or `[FAIL] Scan gate (clean): <reason>`.

**Check 5 — Export**:
1. Create minimal placeholder output in the engagement directory (`test-output/report.md` with benign content, `test-output/data.json` with `{}`).
2. Call `recon.export` with `{ engagementDir, overrideScan: false }`.
3. Assert the returned `zipPath` exists and `sizeBytes > 0`.
4. Assert the zip does not contain `.recon-meta.json` at the root (it should be excluded — check WP01's export spec for exclusion list).
5. Print: `[PASS] Export` or `[FAIL] Export: <reason>`.

**Cleanup**: Remove the engagement directory created in check 2. Remove the zip from check 5. Print `Cleanup complete.`

**Final summary**: Print a count of passing and failing checks. If any failed: `SMOKE TEST FAILED (N/5 passed)` and exit 1. If all passed: `SMOKE TEST PASSED (5/5)` and exit 0.

**Implementation note**: The script needs a way to call sidecar methods without the full Tauri runtime. Check whether the sidecar has a standalone CLI mode (e.g., `node dist/sidecar/index.js --method recon.create --params '{...}'`). If not, the script should use `node -e "require('./dist/sidecar/index.js')..."` or invoke via the sidecar's test harness. Document the invocation pattern used at the top of the script.

### T030 — Create setup runbook

Create `apps/desktop-companion/docs/recon-operator-setup-runbook.md`.

**Audience**: Alex following steps while on a video call with Aaron. Aaron is non-technical. Every step must be completable without a terminal unless explicitly labeled "Alex runs in terminal."

**Sections**:

#### Prerequisites
- Mac with Apple Silicon or Intel (macOS 13 Ventura or later).
- At least 4 GB free disk space.
- Internet connection for credential verification.
- Aaron's Signal contact for credential delivery.

#### Step 1: Install Claude Code (Alex — terminal)
Provide the exact install command from the Claude Code docs. Note: Aaron does not need to do this — Alex verifies it is installed before the call, or runs it on Aaron's machine via screen share.

Verification: `claude --version` returns a version string.

#### Step 2: Deliver the DMG (Alex)
Options in order of preference:
1. AirDrop from Alex's Mac to Aaron's Mac.
2. Shared Google Drive link (time-limited, viewer only).

Aaron: double-click the `.dmg` to open it.

#### Step 3: Install the unsigned app (Aaron)
The app is not notarized for Phase 1. Aaron will see "can't be opened because it is from an unidentified developer."

**Option A (System Settings, preferred)**:
1. Open System Settings → Privacy & Security.
2. Scroll to the Security section.
3. Find the message about the blocked app and click "Open Anyway".
4. Enter Mac password when prompted.

**Option B (terminal, fallback — Alex runs)**:
```bash
xattr -d com.apple.quarantine /Applications/JoyusDesktop.app
```

Drag the app to `/Applications/` before running either option.

#### Step 4: Launch Desktop
Double-click Joyus Desktop in Applications. The app should open to the Setup Wizard (first launch) or the main dashboard.

If the app opens to the main dashboard instead of the Setup Wizard: click "Recon" in the left sidebar, then "Setup" if redirected.

#### Step 5: Complete the Setup Wizard

**Wizard Step 1 — Claude Code**: The wizard auto-detects Claude Code. Should show green check. If red X: go back to Step 1 of this runbook.

**Wizard Step 2 — Credentials**: Aaron enters credentials. Alex delivers each credential via Signal, one at a time. Aaron types each value into the correct field and clicks "Save". After all four are saved, Aaron clicks "Verify All". All fields should show green check. If any shows red X: confirm the value was copied correctly (watch for trailing spaces).

Required credentials (in wizard order):
- Anthropic API Key
- DataForSEO Login
- DataForSEO Password
- CrUX API Key

**Wizard Step 3 — Skill file**: Alex copies `~/.claude/skills/joyus-recon.md` from Alex's machine to `~/.claude/skills/` on Aaron's machine (via AirDrop or `scp` — confirm path). Aaron clicks "Check Again". Should show green check.

If skill file transfer is not possible on the call: skip step 3 for now, complete credentials, and return to the wizard later. The dashboard will redirect back to setup until step 3 passes.

#### Step 6: Run a test engagement
1. Click "New Engagement".
2. Client Name: `Test Run`.
3. URL: `https://zivtech.com`.
4. Access Mode: `RFP (limited)`.
5. Click "Start Engagement".
6. Confirm the progress log shows activity (tool calls, phase transitions).
7. Wait for status to show "Complete" (may take 3–10 minutes depending on site complexity).
8. Click "Scan Output". Should show green PASS banner.
9. Click "Export". Note the zip path.

#### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Wizard Step 1 shows red X | Claude Code not installed or not on PATH | Run `which claude` in terminal. If missing, reinstall. |
| "Verify All" shows red X on API key | Key copied with extra whitespace | Re-enter the key, no spaces. |
| Progress log empty after launch | Sidecar failed to start | Quit and relaunch the app. If recurring, Alex checks logs at `~/Library/Logs/JoyusDesktop/`. |
| Status stuck at "Running" > 15 min | Recon process hung | Click "Cancel", then retry engagement. |
| Scan shows findings on test run | Test URL has content matching scan rules | Use Override (dogfood) and proceed. Note findings for Alex. |
| Export fails | Disk space | Check `df -h ~`. Need at least 200 MB free. |

#### After the Call
Alex: confirm Aaron can find the exported zip and knows where to send it (Slack #recon-output or agreed channel).

Alex: review any scan findings flagged during the test run and update scan rules if patterns are false positives.
