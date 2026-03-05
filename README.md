# joyus-desktop

Desktop companion runtime for Joyus AI.

## Scope
- Session registration and health signaling
- Policy decision client
- Runtime routing for local vs remote sessions
- Secure output metadata emission

## Quality Gates
- `pnpm typecheck` must pass
- `pnpm coverage` must pass with **100%** lines/functions/branches/statements coverage
- CI blocks merges if either gate fails

## Local Commands
- `pnpm install`
- `pnpm typecheck`
- `pnpm coverage`

See `docs/architecture.md` and `docs/threat-model.md`.
