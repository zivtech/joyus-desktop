# Skill Sync Setup (WP03)

**Audience**: Claude Code CLI developers  
**Feature**: 003-skill-mcp-distribution  
**Goal**: Automatically sync skills from `zivtech-meta-skills` at an admin-pinned version with zero manual git steps per session.

## Quick Start (3 Commands)

```bash
pnpm install
export SKILL_SYNC_REPO_URL="<repo-url>" SKILL_SYNC_TARGET_VERSION="<git-tag>"
pnpm exec tsx packages/skill-sync/src/cli.ts --sync --quiet
```

## Prerequisites

- `git` installed and authenticated for the skill repo.
- Node.js 20+.
- Claude Code installed.
- Access to `zivtech-meta-skills` (SSH key or token-backed URL).

## One-Time Setup

1. Set environment configuration:

```bash
export SKILL_SYNC_REPO_URL="git@github.com:zivtech/zivtech-meta-skills.git"
export SKILL_SYNC_TARGET_VERSION="v1.0.0"
export SKILL_SYNC_DEST_DIR="$HOME/.claude/skills"
export SKILL_SYNC_CACHE_DIR="$HOME/.claude/.skill-sync-cache"
```

2. Run initial sync:

```bash
pnpm exec tsx <repo-root>/packages/skill-sync/src/cli.ts --sync
```

3. Verify sync status:

```bash
pnpm exec tsx <repo-root>/packages/skill-sync/src/cli.ts --status
```

4. Register Claude Code startup hook (example):

```json
{
  "hooks": {
    "session_start": {
      "command": "pnpm exec tsx <repo-root>/packages/skill-sync/src/cli.ts --sync --quiet",
      "timeout_ms": 10000,
      "async": true
    }
  }
}
```

Put this in your local Claude Code hooks configuration file.

Alternative: auto-install hook from this repo:

```bash
pnpm skill-sync:hook:install
```

Preview merged hook config without writing:

```bash
pnpm skill-sync:hook:preview
```

## Validation Checklist

- [ ] Initial sync exits with code `0`.
- [ ] `~/.claude/skills/.sync-metadata.json` exists.
- [ ] At least one expected skill file exists under `~/.claude/skills`.
- [ ] `--status` shows `status: "success"`.
- [ ] New Claude Code session triggers sync automatically.

## Offline Behavior

- If network/git remote is unavailable, sync reports `status: "offline"` in metadata.
- Existing synced skills remain usable.
- The command exits successfully for startup hook usage.

## Local Edits and Conflict Recovery

- If you manually edit a synced skill, the next sync overwrites it with pinned content.
- Modified files are backed up to `~/.claude/.skill-sync-backups/<timestamp>/`.
- Only the latest 5 backups are kept.

## Troubleshooting

### Missing repo auth

Symptoms: sync fails with auth errors.  
Fix: verify SSH key/token access to the configured repo URL.

### Invalid version pin

Symptoms: error says invalid target version/tag.  
Fix: confirm tag exists and update `SKILL_SYNC_TARGET_VERSION`.

### No skills after sync

Symptoms: destination folder is empty.  
Fix: check source repo layout and ensure skill files are committed under repo root or `skills/`.

## Hook Artifacts

- Hook template: [claude-code-hooks.skill-sync.json](<repo-root>/config/hooks/claude-code-hooks.skill-sync.json)
- Hook installer: [install-hook.mjs](<repo-root>/scripts/skill-sync/install-hook.mjs)
