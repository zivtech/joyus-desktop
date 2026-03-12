# Version Pinning Guide (WP04)

## Source of Truth

Pinned versions are defined in:

- [distribution-config.json](/Users/AlexUA/claude/joyus-desktop/config/distribution-config.json)

Schema:

- `default_version`: fallback for all clients
- `bundles.<bundle>.version`: bundle-specific override
- `schema_version`: config schema marker

## Admin Update Flow

1. Edit [distribution-config.json](/Users/AlexUA/claude/joyus-desktop/config/distribution-config.json).
2. Change one or more bundle versions (or `default_version`).
3. Commit and deploy configuration.
4. Restart sessions to pick up the change.

## CLI Behavior (skill-sync)

`skill-sync` resolves version in this order:

1. Explicit `--version` or `SKILL_SYNC_TARGET_VERSION`
2. Bundle pin from distribution config (`--bundle` / `SKILL_SYNC_BUNDLE`)
3. `default_version`

Optional config inputs:

- `--distribution-config <path>` / `SKILL_SYNC_DISTRIBUTION_CONFIG`
- `--distribution-config-url <url>` / `SKILL_SYNC_DISTRIBUTION_CONFIG_URL`

## Cowork Behavior

Use the same pinned tag when preparing/uploading plugin artifacts. Admin workflow:

1. Checkout pinned tag from `zivtech-meta-skills`.
2. Build plugin assets from that tag.
3. Upload/update Cowork plugin set.

## Rollback

Rollback is a normal pin update:

1. Set bundle/default version back to prior tag (for example `v1.0.0`).
2. Restart session(s).
3. Verify version in CLI metadata and Cowork behavior.
