# Skill Versioning Convention (WP04 T019)

## Scope

Applies to `zivtech-meta-skills` tags used by Cowork and CLI distribution.

## Semver Rules

- `MAJOR` (`vX.0.0`): breaking format changes, removed skills, incompatible plugin structure.
- `MINOR` (`v0.X.0`): new skills or non-breaking enhancements.
- `PATCH` (`v0.0.X`): prompt/text fixes, typo/docs-only changes.

## Release Process

1. Update `CHANGELOG.md` in `zivtech-meta-skills`.
2. Commit changelog.
3. Create tag:

```bash
git tag vX.Y.Z
git push origin main --tags
```

4. Update pin in [distribution-config.json](/Users/AlexUA/claude/joyus-desktop/config/distribution-config.json) (or via control-plane endpoint when available).

## Initial Baseline

- Baseline pin: `v1.0.0`.
- All bundles should initially point to `v1.0.0` unless explicitly overridden.

## Changelog Starter (for zivtech-meta-skills)

```markdown
# Changelog

## v1.0.0 - 2026-03-10
- Initial release of distributed skill set
- Role-based bundle support (PM, Developer, Milk Jawn, Full)
```
