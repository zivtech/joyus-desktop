# Quickstart: Managed Git Sessions (Feature 006)

**Prerequisites**: Features 001–005 merged. `pnpm install` complete. Node.js 24+.

---

## Package Layout

```
packages/session-manager/    ← new: TaskBranch store + worktree ops + file mod detection
packages/drift-detector/     ← new: 3-signal heuristics engine
apps/desktop-companion/src/
  sidecar/services.ts        ← modified: registers session.fileModified IPC method
  sidecar/sessionWiring.ts   ← new: wires session-manager + drift-detector into sidecar
  ui/pages/Sessions.tsx      ← new: /sessions route in React router
```

---

## Running Tests

```bash
# All tests (from repo root)
pnpm test

# Single package
pnpm vitest run packages/session-manager/test/
pnpm vitest run packages/drift-detector/test/

# Integration tests only
pnpm vitest run apps/desktop-companion/test/integration/

# Coverage (enforced at 100%)
pnpm coverage
```

---

## Local Development

### 1. Trigger session.fileModified via IPC

The sidecar listens on stdin. Send a JSON-RPC notification:

```bash
echo '{"jsonrpc":"2.0","method":"session.fileModified","params":{"sessionId":"test-session-1","repoPath":"/path/to/repo","filePath":"/path/to/repo/src/index.ts"}}' \
  | nc -q1 localhost 0  # adjust to your sidecar's stdio setup
```

Or use the Claude Code hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"jsonrpc\":\"2.0\",\"method\":\"session.fileModified\",\"params\":{\"sessionId\":\"${SESSION_ID}\",\"repoPath\":\"${PWD}\",\"filePath\":\"${TOOL_OUTPUT_PATH}\"}}' | <sidecar-ipc-pipe>"
          }
        ]
      }
    ]
  }
}
```

### 2. Inspect the SQLite store

```bash
sqlite3 ~/.joyus/session-manager.db \
  "SELECT id, mission_label, status, mode, datetime(created_at/1000,'unixepoch') FROM task_branches;"
```

### 3. Verify worktrees

```bash
cd /path/to/your/repo
git worktree list
# Expected: one entry per active joyus/* branch
```

### 4. Test drift detection

```bash
# Run the drift detector test suite with threshold fixture scenarios
pnpm vitest run packages/drift-detector/test/ --reporter=verbose
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JOYUS_SESSION_DB_PATH` | `~/.joyus/session-manager.db` | Override SQLite path (useful for tests) |
| `JOYUS_POLL_INTERVAL_MS` | `10000` | File modification poll interval in ms |
| `JOYUS_STALE_THRESHOLD_DAYS` | `14` | Days before a TaskBranch is flagged stale |
| `JOYUS_DRIFT_DIR_THRESHOLD` | `3` | Directory count drift threshold |
| `JOYUS_DRIFT_DOMAIN_THRESHOLD` | `2` | Topic domain count drift threshold |
| `JOYUS_DRIFT_TIME_THRESHOLD_MIN` | `30` | Elapsed time drift threshold (minutes) |

---

## GitHub Desktop Integration (P2)

To test the "Open in GitHub Desktop" action locally:

```bash
# macOS — verify the URL protocol handler is registered
open "x-github-client://openRepo?cloneURL=file:///path/to/repo"
```

If GitHub Desktop is not installed, the command fails silently — the Sessions page should show a download prompt instead.

**Note**: Verify the exact current URL protocol path before implementing WP that covers this feature. The protocol scheme has changed across GitHub Desktop versions.

---

## Troubleshooting

**TaskBranch shows as "broken"**: The worktree path no longer exists on disk. Run cleanup from the Sessions panel or:
```bash
sqlite3 ~/.joyus/session-manager.db \
  "UPDATE task_branches SET status='broken' WHERE worktree_path='/missing/path';"
```

**Worktree creation fails**: Confirm the repo is not bare (`git rev-parse --is-bare-repository`) and the app has write access to the repo root.

**Poll not triggering**: Check `JOYUS_POLL_INTERVAL_MS` and confirm the sidecar process is running. The poll uses `git status --porcelain` in the repo root — if git is not on PATH for the sidecar process, it will silently fail.
