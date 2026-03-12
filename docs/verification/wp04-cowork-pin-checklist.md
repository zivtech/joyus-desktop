# WP04 Cowork Pin Checklist (T021)

Use this checklist to prove Cowork distribution respects the pin.

## Test Data

- Bundle: `developer-bundle` (or target bundle)
- Before tag: `v1.0.0`
- After tag: `v1.1.0`
- Marker skill: choose one skill with an intentional, visible marker change between tags.

## Preparation

- [ ] Confirm both tags exist in `zivtech-meta-skills`.
- [ ] Confirm marker change is documented (prompt text or expected output change).
- [ ] Confirm admin account has Cowork plugin upload rights.
- [ ] Confirm test user is non-admin and assigned target bundle.

## Before Pin (`v1.0.0`)

1. Set pin to `v1.0.0`.
2. Build plugin package from tag `v1.0.0`.
3. Upload/update Cowork plugin set.
4. Start a fresh Cowork session as non-admin.
5. Run marker prompt.
6. Record observed marker/output.

Expected: marker/output matches `v1.0.0` behavior.

## After Pin (`v1.1.0`)

1. Update pin to `v1.1.0`.
2. Build plugin package from tag `v1.1.0`.
3. Upload/update Cowork plugin set.
4. Start one new Cowork session (single restart).
5. Run the same marker prompt.
6. Record observed marker/output.

Expected: marker/output matches `v1.1.0` behavior and differs from `v1.0.0` marker.

## Evidence Table

| Step | Timestamp | User | Prompt | Expected Marker | Actual Marker | Pass/Fail |
|---|---|---|---|---|---|---|
| Before pin check | | | | v1.0.0 | | |
| After pin check | | | | v1.1.0 | | |

## Decision

- [ ] T021 complete: Cowork served pinned version before and after pin change.
- [ ] No unexpected auto-upgrade to unpinned tag observed.
