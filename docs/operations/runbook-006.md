# Runbook 006 — Managed Git Sessions

**Feature**: 006 — Managed Git Sessions
**Last verified**: 2026-03-20
**Review when**: `session-manager`, `drift-detector`, or `sessionWiring.ts` changes

---

## 1. Pre-Pilot Checklist

Before shipping feature 006 to the first non-technical pilot user:

- [ ] `pnpm ci` passes — TypeScript strict check + 100% coverage threshold
- [ ] All acceptance tests pass: `pnpm vitest run apps/desktop-companion/test/acceptance/`
- [ ] Git terminology blocklist sweep clean (T042 — `terminologyBlocklist.test.ts`)
- [ ] Drift corpus ≥95% fire rate confirmed (T043 — `driftCorpus.test.ts`)
- [ ] Timing budgets verified locally: SC-003 batch cleanup < 60s, SC-004 resume < 3s
- [ ] Verify `git` binary is on PATH in the production sidecar environment
- [ ] Verify `~/.joyus/` directory creation works on a fresh machine (no prior Joyus install)
- [ ] Manual smoke test: create a real session, modify 2 files, verify TaskBranch appears in the Sessions panel
- [ ] Manual smoke test: switch to advisory mode, modify files, confirm no TaskBranch is auto-created

---

## 2. Alert: `sidecar.session.worktreeCreateFailed`

**Trigger**: `state.error` notification with `source: 'session.worktree'`

**Likely causes**:
- `git` binary not on PATH in the sidecar's shell environment
- Insufficient disk space for the new worktree
- Repository locked by another git process (`.git/index.lock` exists)

**Resolution steps**:
1. Check sidecar logs: `~/.joyus/logs/sidecar.log` (if log rotation is enabled)
2. Verify `git --version` works from the sidecar's shell environment (check PATH in the Tauri sidecar launch config)
3. Check disk space: `df -h ~`
4. Check for a stale lock file: `ls -la {repoPath}/.git/*.lock` — remove it **only if no git process is running**
5. The affected TaskBranch will show `status: 'broken'` in the Sessions panel. The user can remove it via the Remove button; the next file modification will auto-create a fresh one.

---

## 3. Alert: `sidecar.session.dbOpenFailed`

**Trigger**: Sidecar startup fails with a SQLite error (logged to stderr, visible in Tauri dev tools console)

**Likely causes**:
- `~/.joyus/session-manager.db` is corrupted (e.g., disk ran full during a write)
- File permissions on `~/.joyus/` were changed

**Resolution steps**:
1. Back up the database before touching it:
   ```bash
   cp ~/.joyus/session-manager.db ~/.joyus/session-manager.db.bak
   ```
2. Delete the corrupt file:
   ```bash
   rm ~/.joyus/session-manager.db
   ```
3. Restart the desktop companion — it will create a fresh database on startup.
4. **Note**: Existing TaskBranch records are lost, but the git worktrees themselves remain on disk under `{repoPath}/.joyus-worktrees/`. Users can clean them up manually (`git worktree remove --force {path}`) or via the Sessions panel after the sidecar reconnects.

---

## 4. Incident: Worktrees Accumulating Unexpectedly

**Symptom**: User reports many sessions showing "Inactive" status; disk usage growing in the repo directory under `.joyus-worktrees/`.

**Likely cause**: Stale detection did not run — sidecar crashed before `initialize()` completed on a prior startup. Worktrees were created but never marked stale.

**Resolution**:
1. In the Sessions panel, click **"Clean up inactive tasks"** to batch-delete all stale branches.
2. For manual cleanup of orphaned git worktrees:
   ```bash
   cd {repoPath}
   git worktree list
   git worktree remove --force {path}  # for each orphaned entry
   git worktree prune                  # clean up stale references
   ```
3. If the sidecar crashes on every startup, check for a corrupt database (see Alert 3 above) or check for conflicting Joyus processes.

---

## 5. Incident: Drift Signals Not Appearing

**Symptom**: User reports working across many files with no drift suggestions appearing in the Sessions panel, even after editing files across multiple domains.

**Likely causes**:
- `state.driftSignal` Tauri event is not reaching the WebView (event routing issue)
- All drift signals for the current session were dismissed and the fingerprints match — the detector is correctly suppressing repeats
- Drift detector thresholds not reached yet (need ≥3 directories OR ≥2 topic domains OR ≥30 min elapsed)

**Resolution**:
1. Check that `sendNotification('state.driftSignal', ...)` is being called in the sidecar: add a temporary `console.log` in `sessionWiring.ts` around the `if (signal !== null)` block and restart the sidecar in dev mode.
2. Check the Tauri event bridge: open Tauri dev tools (right-click → Inspect), look for `state.driftSignal` in the console or network tab.
3. If signals are firing but the UI doesn't show them: force-refresh the WebView in Tauri dev mode (`Cmd+R` on macOS).
4. **Dismissal note**: Drift dismissals persist in memory only (not in SQLite). A sidecar restart clears all dismissed fingerprints, which will allow signals to re-fire for the same session state.
5. If the user has been working in a single directory on files that don't map to recognized topic domains, the directory and domain thresholds may not be reached. The elapsed-time threshold (30 minutes) will still fire.
