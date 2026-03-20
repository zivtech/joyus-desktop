---
work_package_id: "WP03"
title: "drift-detector: Heuristics Engine"
lane: "planned"
dependencies: []
subtasks: ["T015", "T016", "T017", "T018", "T019", "T020"]
history:
  - date: "2026-03-19"
    event: "created"
---

# WP03 — drift-detector: Heuristics Engine

**Feature**: 006 — Managed Git Sessions
**Priority**: P1 (blocks WP04; can run in parallel with WP01 and WP02)
**Implement with**: `spec-kitty implement WP03`

## Objective

Create `packages/drift-detector` with the 3-signal heuristics engine, session state tracking, and dismissal logic. v1 ships heuristics-only; the `DriftConfirmer` interface is defined and stubbed (always returns `null`) so the LLM path can be added in a follow-up work package without breaking any existing code.

## Context

**New package**: `packages/drift-detector`
**Contract file**: `kitty-specs/006-managed-git-sessions/contracts/drift-detector.ts` — implement these interfaces exactly.
**Data model**: `kitty-specs/006-managed-git-sessions/data-model.md` — `DriftHeuristicResult`, `DriftSignal`, `DriftThresholds`, topic domain table.

**Default thresholds** (from spec FR-003, SC-002):
- `directoryCount`: 3
- `topicDomainCount`: 2
- `elapsedMinutes`: 30

**Confidence rule**: `confidence = thresholdsExceeded >= 2 ? "high" : "low"`

This package has zero I/O — all logic is pure TypeScript. Tests are pure unit tests with `vi.useFakeTimers()` for elapsed-time scenarios.

## Subtasks

### T015 — Package Scaffold

**Purpose**: Create `packages/drift-detector` with correct monorepo configuration.

**Steps**:

1. Create `packages/drift-detector/package.json`:
```json
{
  "name": "@joyus/drift-detector",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "coverage": "vitest run --coverage"
  }
}
```

2. Create `packages/drift-detector/tsconfig.json` — copy from `packages/policy-client/tsconfig.json`.
3. Create `packages/drift-detector/src/index.ts` (empty).
4. Create `packages/drift-detector/test/` directory.
5. Add `@joyus/drift-detector` to `apps/desktop-companion/package.json` dependencies.

**Validation**:
- [ ] `pnpm typecheck` passes from package root
- [ ] Package resolvable as `@joyus/drift-detector`

---

### T016 — `TopicDomainInferrer`

**Purpose**: Map file paths to topic domains using a keyword-lookup table.

**Steps**:

1. Create `packages/drift-detector/src/topicDomainInferrer.ts`.

2. Implement the keyword-to-domain mapping:
```typescript
const DOMAIN_KEYWORDS: ReadonlyMap<TopicDomain, readonly string[]> = new Map([
  ['frontend',      ['components', 'ui', 'pages', 'views', 'styles', 'css', 'scss', 'tsx', 'jsx']],
  ['backend',       ['api', 'routes', 'controllers', 'handlers', 'middleware', 'server', 'services']],
  ['testing',       ['test', 'spec', '__tests__', 'fixtures', 'mocks', 'vitest']],
  ['documentation', ['docs', 'documentation', 'readme', 'changelog', 'md']],
  ['configuration', ['config', 'settings', 'env', '.github', 'ci', 'cd', '.claude']],
  ['data',          ['schema', 'migration', 'db', 'database', 'models', 'sqlite']],
  ['tooling',       ['scripts', 'bin', 'tools', 'build', 'vite', 'rollup', 'esbuild']],
  ['security',      ['auth', 'security', 'permissions', 'crypto', 'jwt', 'token']],
]);
```

3. Implement `inferTopicDomain(filePath: string): TopicDomain`:
   - Normalize to lowercase
   - Split path into segments
   - First segment match in `DOMAIN_KEYWORDS` wins
   - Falls back to checking file extension (e.g., `.css` → `frontend`)
   - Returns `"other"` if no match

4. Export `TopicDomainInferrer` class and standalone `inferTopicDomain` function.

**Files**: `packages/drift-detector/src/topicDomainInferrer.ts`

**Validation**:
- [ ] `inferTopicDomain('src/components/Button.tsx')` → `"frontend"`
- [ ] `inferTopicDomain('api/routes/users.ts')` → `"backend"`
- [ ] `inferTopicDomain('unknown/mystery.xyz')` → `"other"`
- [ ] Case-insensitive matching

---

### T017 — `HeuristicsEngine`

**Purpose**: Evaluate the 3 drift signals against configured thresholds and produce a `DriftHeuristicResult`.

**Steps**:

1. Create `packages/drift-detector/src/heuristicsEngine.ts`.

2. Implement `evaluateHeuristics(params, thresholds): DriftHeuristicResult`:
```typescript
interface EvaluationParams {
  readonly observedPaths: ReadonlySet<string>;
  readonly sessionStartedAt: number;
  readonly nowMs: number;
}
```

3. Signal evaluation:
   - **Directory count**: Extract top-level directory from each path (`path.split('/')[0]`). Count distinct values.
   - **Topic domain count**: Run `inferTopicDomain` on each path. Count distinct non-`"other"` domains.
   - **Elapsed minutes**: `(nowMs - sessionStartedAt) / 60_000`

4. Set `thresholdsExceeded = [directoryExceeded, topicDomainExceeded, elapsedExceeded].filter(Boolean).length`

5. Inject `nowMs` as a parameter (not `Date.now()` directly) so tests can use `vi.useFakeTimers()`.

**Files**: `packages/drift-detector/src/heuristicsEngine.ts`

**Validation**:
- [ ] All three signals evaluated independently
- [ ] `thresholdsExceeded` count is correct for each combination
- [ ] `nowMs` injection enables deterministic time tests
- [ ] Empty path set produces all zeros

---

### T018 — `DriftDetector`

**Purpose**: Coordinate session state tracking, threshold evaluation, and dismissal logic.

**Steps**:

1. Create `packages/drift-detector/src/driftDetector.ts`.

2. `DriftDetector` maintains an in-memory `Map<taskBranchId, DriftSessionState>`.

3. Implement `observe({ taskBranchId, filePath, sessionStartedAt })`:
   - Create or update `DriftSessionState` for `taskBranchId`
   - Add `filePath` to `observedPaths`
   - Call `evaluateHeuristics` with current state and configured thresholds
   - If `thresholdsExceeded >= 1`:
     - Compute signal fingerprint: `JSON.stringify({ directoryCount, topicDomainCount, elapsedMinutes: Math.floor(...) })`
     - If fingerprint is in `dismissedFingerprints`: return `null` (don't re-prompt)
     - Call `confirmer.confirm(...)` (always returns `null` in v1)
     - Return a `DriftSignal` with correct confidence
   - Otherwise return `null`

4. Implement `dismiss(signal: DriftSignal)`:
   - Add `signal`'s fingerprint to `dismissedFingerprints` for that `taskBranchId`

5. Implement `getState(taskBranchId)`, `clearSession(taskBranchId)`.

**Files**: `packages/drift-detector/src/driftDetector.ts`

**Validation**:
- [ ] First observation below threshold → `null`
- [ ] Observation crossing threshold → `DriftSignal` returned
- [ ] Dismissed signal fingerprint → `null` on re-observation
- [ ] `clearSession` removes all state for that branch
- [ ] `confirmer.confirm` is called on high-confidence signal

---

### T019 — `NoOpDriftConfirmer`

**Purpose**: v1 stub that always returns `null` without making any LLM call.

**Steps**:

1. Add to `packages/drift-detector/src/driftDetector.ts` or a separate `noOpDriftConfirmer.ts`:

```typescript
export class NoOpDriftConfirmer implements DriftConfirmer {
  async confirm(): Promise<null> {
    return null;
  }
}
```

2. Use `NoOpDriftConfirmer` as the default `confirmer` in `createDriftDetector` factory when none is provided.

3. Export `createDriftDetector(deps?: DriftDetectorDeps): DriftDetector` as the public factory.

**Files**: `packages/drift-detector/src/driftDetector.ts`

**Validation**:
- [ ] `createDriftDetector()` (no deps) uses `NoOpDriftConfirmer`
- [ ] Custom `confirmer` is used when provided
- [ ] `NoOpDriftConfirmer.confirm()` always resolves to `null` without throwing

---

### T020 — Unit Tests + Drift Scenario Corpus

**Purpose**: 100% coverage plus the 15-scenario corpus required by SC-002.

**Test file**: `packages/drift-detector/test/topicDomainInferrer.test.ts`, `packages/drift-detector/test/heuristicsEngine.test.ts`, `packages/drift-detector/test/driftDetector.test.ts`

**Corpus — "should fire" scenarios (10)** (directory threshold OR domain threshold OR time threshold exceeded):

| # | Paths | Elapsed | Expected confidence |
|---|---|---|---|
| 1 | 3 dirs (src, api, docs), 1 domain | 0 min | low (dir threshold only) |
| 2 | 1 dir, 2 domains (frontend+backend) | 0 min | low (domain threshold only) |
| 3 | 1 dir, 1 domain | 30 min | low (time threshold only) |
| 4 | 3 dirs, 2 domains | 0 min | high (dir + domain) |
| 5 | 3 dirs, 1 domain | 30 min | high (dir + time) |
| 6 | 1 dir, 2 domains | 30 min | high (domain + time) |
| 7 | 4 dirs, 3 domains | 45 min | high (all three) |
| 8 | 3 dirs exactly (at threshold) | 0 min | low |
| 9 | 2 domains exactly (at threshold) | 0 min | low |
| 10 | 30 min exactly | 0 dirs, 0 domains | low |

**Corpus — "should not fire" scenarios (5)**:

| # | Paths | Elapsed | Expected |
|---|---|---|---|
| 1 | 2 dirs, 1 domain | 25 min | null (no threshold met) |
| 2 | Same as scenario #4 but fingerprint dismissed | — | null (dismissal honored) |
| 3 | 3 dirs, 2 domains — second observe after clearSession | — | fires again (state cleared) |
| 4 | 0 paths | 0 min | null |
| 5 | 2 dirs, 0 non-"other" domains | 0 min | null |

**Additional unit tests**:
- `NoOpDriftConfirmer.confirm()` returns null
- `observe` accumulates paths across multiple calls
- `dismiss` stores fingerprint and blocks re-prompt
- `getState` returns current snapshot without triggering evaluation

**Validation**:
- [ ] All 10 "should fire" scenarios produce a `DriftSignal`
- [ ] All 5 "should not fire" scenarios return `null`
- [ ] `pnpm coverage` at 100% for all WP03 source files
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `packages/drift-detector` package created and resolvable
- [ ] Source files: `topicDomainInferrer.ts`, `heuristicsEngine.ts`, `driftDetector.ts`, `index.ts`
- [ ] Test files with 15-scenario corpus passing
- [ ] `pnpm coverage` at 100%
- [ ] `pnpm typecheck` passes
- [ ] Public API exported: `createDriftDetector`, `NoOpDriftConfirmer`, `DEFAULT_DRIFT_THRESHOLDS`, `inferTopicDomain`

## Risks

- **Fingerprint stability**: The dismissed signal fingerprint uses `Math.floor(elapsedMinutes)` to avoid re-prompting within the same minute. If elapsedMinutes changes significantly between dismiss and next observe, a new signal fires — this is correct behavior.
- **`"other"` domain exclusion**: The topic domain count MUST NOT include `"other"`. A session that only touches unrecognized file types should not count as multi-domain.
- **Fake timers + async**: `observe()` is async (calls `confirmer.confirm()`). Tests must `await` observe calls even though v1 resolves immediately.

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
