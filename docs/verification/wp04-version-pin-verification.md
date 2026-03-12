# WP04 Version Pin Verification (SC-005)

**Feature**: 003-skill-mcp-distribution  
**Work Package**: WP04 - Version Pinning & Admin Controls  
**Status**: Ready to execute

## Test Objective (SC-005)

Verify a pin change propagates to both channels within one session restart.

## Preconditions

- [ ] Tags exist in source skill repo (for example `v1.0.0`, `v1.1.0`).
- [ ] Distribution config updated and deployed.
- [ ] Cowork plugin process uses pinned tag.
- [ ] CLI users configured with bundle/config settings.

## Concrete Scenario

- Before pin: `v1.0.0`
- After pin: `v1.1.0`
- Bundle under test: `developer-bundle`

## CLI Verification (Automated)

Run:

```bash
pnpm skill-sync:verify-pin
```

Expected:

- Script exits `0`
- Evidence file is created in `docs/verification/evidence/`
- Report shows:
  - before version = `v1.0.0`
  - after version = `v1.1.0`
  - restart count = `1`

## Cowork Verification (Manual)

1. Set distribution pin for target bundle to `v1.0.0`.
2. Build/upload Cowork plugin artifacts from `v1.0.0` tag.
3. Start a fresh Cowork session as non-admin and run a marker prompt against a known changed skill.
4. Record behavior/output marker as `v1.0.0`.
5. Update bundle pin to `v1.1.0`.
6. Build/upload Cowork plugin artifacts from `v1.1.0` tag.
7. Start one new Cowork session (single restart) and run the same marker prompt.
8. Record behavior/output marker as `v1.1.0`.

## Evidence Table

| Channel | User | Before Pin | After Pin | Restart Count | Result |
|---|---|---|---|---:|---|
| Cowork | | | | | |
| CLI | automated script | | | 1 | |

## Timing

| Channel | Pin Updated At | New Session At | Updated Visible At | Delta |
|---|---|---|---|---|
| Cowork | | | | |
| CLI | (from script report) | (from script report) | (from script report) | |

## Signoff

- [ ] SC-005 satisfied: both channels updated within one session restart.
