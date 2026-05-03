# Skill Sync Hook Integration (T014)

This guide wires `skill-sync` into Claude Code session startup.

## Option A: Scripted Install (recommended)

```bash
pnpm skill-sync:hook:install
```

This updates `~/.claude/hooks.json` and creates a timestamped backup if the file already exists.

## Option B: Manual Template

Use this template and merge into your hook config:

- [claude-code-hooks.skill-sync.json](/Users/AlexUA_1/claude/joyus-desktop/config/hooks/claude-code-hooks.skill-sync.json)

## Verify Hook

1. Start a new Claude Code session.
2. Run:

```bash
pnpm exec tsx /Users/AlexUA_1/claude/joyus-desktop/packages/skill-sync/src/cli.ts --status
```

3. Confirm `lastAttempt`/`lastSync` updated in metadata.

## Performance Check (NFR-002)

Warm-cache sync must complete under 10 seconds.

```bash
pnpm skill-sync:tester -- --tester local-check --repo-url <repo-url> --version <tag>
```

Review `Warm sync duration (ms)` in the generated report.
