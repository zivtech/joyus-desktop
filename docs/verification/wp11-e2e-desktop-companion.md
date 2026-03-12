# WP11 — E2E Desktop Companion Verification (T061)

**Feature**: 003 - Skill MCP Distribution
**Phase**: Phase 2 — Desktop Companion
**Success Criterion**: SC-006 (partial), NFR-003
**Date**: _______________
**Tester**: _______________
**macOS Version**: _______________
**Node.js Version**: _______________
**Claude Code Version**: _______________

---

## 1. Pre-Conditions

Before starting the E2E verification, confirm the following:

| Pre-Condition | Status | Notes |
|---------------|--------|-------|
| Clean machine OR previous companion fully uninstalled | [ ] | Run `ps aux \| grep joyus` to confirm no residual processes |
| No existing MCP entries in `~/.claude/.mcp.json` for axe-core, lighthouse, or screenshot | [ ] | Back up and remove if present |
| Node.js >= 18 installed and in PATH | [ ] | `node --version` |
| Claude Code CLI installed and authenticated | [ ] | `claude --version` |
| Network connectivity (broadband) | [ ] | Required for download |
| At least 500 MB free disk space | [ ] | Chromium dependency ~200 MB |

---

## 2. Installation & Provisioning

### Step 1: Install Desktop Companion

**Timestamp start**: _______________

1. Download the joyus-desktop installer from the designated distribution channel.
2. Run the installer (`.dmg` or `brew install`).
3. Follow any on-screen prompts (grant accessibility/network permissions if requested).
4. Wait for installation to complete.

**Timestamp end**: _______________
**Duration**: _______________

### Step 2: First Launch & MCP Provisioning

**Timestamp start**: _______________

1. Launch joyus-desktop (it may auto-launch after install).
2. Observe the provisioning progress:
   - MCP server binaries downloaded/extracted
   - Chromium runtime provisioned (for browser-based MCPs)
   - MCP entries registered in `~/.claude/.mcp.json`
3. Wait for provisioning to complete (system tray icon should indicate ready state).

**Timestamp end**: _______________
**Duration**: _______________

---

## 3. System Tray Verification

| Check | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| System tray icon visible | Joyus icon present in menu bar | | |
| Tray menu accessible | Click opens status menu | | |
| axe-core server status | Running / green indicator | | |
| lighthouse server status | Running / green indicator | | |
| screenshot server status | Running / green indicator | | |
| Overall companion status | "All MCP servers running" or equivalent | | |

---

## 4. Claude Code MCP Tool Verification

### Step 3: Open Claude Code

**Timestamp**: _______________

1. Open a new terminal session.
2. Run `claude` to start a Claude Code session.
3. Verify MCP tools are listed in available tools.

| MCP Server | Expected Tools | Tools Visible | Pass/Fail |
|------------|---------------|---------------|-----------|
| axe-core | `mcp__axe-core__*` (accessibility scan) | | |
| lighthouse | `mcp__lighthouse__*` (performance audit) | | |
| screenshot | `mcp__screenshot__*` (page capture) | | |

### Step 4: axe-core Accessibility Scan

**Timestamp**: _______________

1. Ask Claude: "Run an axe-core accessibility scan on https://example.com"
2. Verify:
   - Tool call is made to the axe-core MCP server
   - Results include accessibility violations (or confirmation of no violations)
   - Output is structured (not a generic fallback response)

**Result**: _______________
**Evidence** (paste key output or attach screenshot):

```
[paste axe-core output here]
```

### Step 5: Lighthouse Performance Report

**Timestamp**: _______________

1. Ask Claude: "Generate a Lighthouse performance report for https://example.com"
2. Verify:
   - Tool call is made to the lighthouse MCP server
   - Report includes performance score, metrics (FCP, LCP, CLS, etc.)
   - Output is structured with actionable data

**Result**: _______________
**Evidence** (paste key output or attach screenshot):

```
[paste lighthouse output here]
```

### Step 6: Screenshot Capture

**Timestamp**: _______________

1. Ask Claude: "Take a screenshot of https://example.com"
2. Verify:
   - Tool call is made to the screenshot MCP server
   - A screenshot image is captured (file path or inline image returned)
   - Image is valid and shows the expected page content

**Result**: _______________
**Evidence** (paste key output or attach screenshot path):

```
[paste screenshot output here]
```

---

## 5. Timing Summary

| Metric | Target | Actual | Pass/Fail |
|--------|--------|--------|-----------|
| Install time (download + install) | < 3 min | | |
| Provisioning time (MCP setup) | < 2 min | | |
| **Total install-to-working time** | **< 5 min (NFR-003)** | | |
| Time to first successful tool call | < 6 min | | |

---

## 6. Evidence Table

| Step | Timestamp | Result | Evidence |
|------|-----------|--------|----------|
| Pre-condition checks | | | |
| Companion install | | | |
| MCP provisioning | | | |
| System tray verification | | | |
| Claude Code launch | | | |
| axe-core scan | | | |
| Lighthouse report | | | |
| Screenshot capture | | | |
| Restart test | | | |
| Graceful degradation test | | | |

---

## 7. Restart Test

**Purpose**: Verify that stopping and restarting the companion restores full functionality.

### Steps

1. **Stop the companion**: Quit joyus-desktop from the system tray or via `killall joyus-desktop`.
   - **Timestamp**: _______________
2. **Verify MCPs are unavailable**: In a new Claude Code session, attempt a tool call.
   - Expected: MCP tools are unavailable or return connection errors.
   - **Result**: _______________
3. **Restart the companion**: Launch joyus-desktop again.
   - **Timestamp**: _______________
4. **Verify MCPs are restored**: In a new Claude Code session, attempt tool calls.
   - Expected: All three MCP tools respond successfully.
   - **Result**: _______________

| Check | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| MCPs unavailable after stop | Tools fail gracefully | | |
| Companion restart completes | System tray shows ready | | |
| MCPs available after restart | All three tools respond | | |

---

## 8. Graceful Degradation Test

**Purpose**: Verify that when the desktop companion is stopped, Claude Code does not crash and handles missing MCPs gracefully.

### Steps

1. **Stop the companion** (if not already stopped from Step 7).
2. **Start a Claude Code session**.
3. **Request an axe-core scan**: Ask Claude to run an accessibility scan.
4. **Observe behavior**:
   - Expected: Claude reports that the tool is unavailable or the MCP server is not running. No crash, no hang, no unhandled exception.
   - NOT expected: Session crash, infinite retry loop, or silent failure with misleading output.

| Check | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| Claude Code starts without companion | Session starts normally | | |
| Tool call to stopped MCP | Error message, not crash | | |
| Session remains usable after failed tool call | Can continue conversation | | |
| Cloud MCPs still work (if configured) | Cowork/cloud tools unaffected | | |

---

## 9. Overall Verdict

| Criterion | Status |
|-----------|--------|
| Desktop companion installs successfully | [ ] Pass / [ ] Fail |
| All three local MCPs provisioned | [ ] Pass / [ ] Fail |
| All three MCP tools callable from Claude Code | [ ] Pass / [ ] Fail |
| Install-to-working time < 5 minutes (NFR-003) | [ ] Pass / [ ] Fail |
| System tray shows correct server status | [ ] Pass / [ ] Fail |
| Restart restores full functionality | [ ] Pass / [ ] Fail |
| Graceful degradation on companion stop | [ ] Pass / [ ] Fail |

**Overall E2E Result**: [ ] PASS / [ ] FAIL

**Notes**:

---

**Tester Signature**: _______________
**Date**: _______________
