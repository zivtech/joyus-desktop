---
work_package_id: WP01
title: Package Scaffold & Manifest Module
lane: "in_progress"
dependencies: []
requirement_refs: [FR-002, FR-003, FR-006, FR-016]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005, T006]
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP01: Package Scaffold & Manifest Module

**Implement command**: `spec-kitty implement WP01`

## Objective

Scaffold the new `packages/settings-reconciler` package and implement the manifest module — types, validation, and fetching. This is the foundation that all other WPs depend on.

## Context

- This is a new package in the pnpm monorepo alongside `skill-sync`, `policy-client`, `session-agent`, etc.
- Follow existing package patterns exactly (see `packages/skill-sync/` for reference: package.json structure, tsconfig.json, ESM setup, test layout)
- The contract types in `kitty-specs/008-managed-tooling-distribution/contracts/distribution-manifest.ts` are the design source — adapt them into the actual implementation
- All packages use TypeScript strict mode, ES2022 target, ESM, vitest with v8 coverage at 100%

## Subtasks

### T001: Scaffold packages/settings-reconciler

**Purpose**: Create the package structure matching existing monorepo conventions.

**Steps**:
1. Create `packages/settings-reconciler/package.json`:
   - Name: `@joyus/settings-reconciler`
   - Version: `0.1.0`
   - Type: `module`
   - Main/types pointing to `src/index.ts`
   - Scripts: match skill-sync (test, coverage, typecheck)
   - No external runtime dependencies — Node built-ins only
2. Create `packages/settings-reconciler/tsconfig.json`:
   - Extend from root tsconfig or match skill-sync's config
   - Strict mode, noUncheckedIndexedAccess, exactOptionalPropertyTypes
   - ES2022 target, ESM module resolution
3. Create `packages/settings-reconciler/src/index.ts` (empty initially, populated in T005)
4. Create `packages/settings-reconciler/test/` directory
5. Add `packages/settings-reconciler` to root `pnpm-workspace.yaml` if not auto-discovered by `packages/*` glob
6. Run `pnpm install` to link the new package

**Files**:
- `packages/settings-reconciler/package.json` (new, ~25 lines)
- `packages/settings-reconciler/tsconfig.json` (new, ~15 lines)
- `packages/settings-reconciler/src/index.ts` (new, placeholder)

**Validation**:
- [ ] `pnpm install` succeeds
- [ ] `pnpm typecheck` passes with the new package included

---

### T002: Define manifest types

**Purpose**: Create the TypeScript types that define the distribution manifest schema.

**Steps**:
1. Create `packages/settings-reconciler/src/manifest.ts`
2. Define types adapted from `contracts/distribution-manifest.ts`:
   - `HookEventType` — union of all valid Claude Code hook event types: `"PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "PreCompact" | "Stop" | "SubagentStart" | "SubagentStop" | "PermissionRequest"`
   - `SettingsTarget` — `"global" | "project"`
   - `ManifestHook` — `{ id, event, matcher, command, timeout?, target? }`
   - `ManifestMcpServer` — `{ id, command, args?, env?, target? }`
   - `ManifestBundle` — `{ version, hooks?, mcpServers?, config? }`
   - `DistributionManifest` — `{ schema_version, tenant_id, bundles, config_path? }`
3. All types should use `readonly` properties and `Readonly<>` wrappers for collections

**Files**:
- `packages/settings-reconciler/src/manifest.ts` (new, ~60 lines)

**Validation**:
- [ ] Types compile with strict TypeScript
- [ ] All properties are readonly

---

### T003: Implement manifest validation

**Purpose**: Validate that a parsed JSON object conforms to the DistributionManifest schema.

**Steps**:
1. In `manifest.ts`, implement `isValidManifest(value: unknown): value is DistributionManifest`
   - Check `schema_version` is a string
   - Check `tenant_id` is a string
   - Check `bundles` is an object with valid ManifestBundle values
   - For each bundle: validate `version` is a string
   - For each hook in a bundle: validate `id` starts with `joyus:`, `event` is a valid HookEventType, `command` is a non-empty string, `matcher` is a string
   - For each MCP server: validate `id` starts with `joyus:`, `command` is a non-empty string
2. Implement `validateManifest(value: unknown): DistributionManifest` that throws with a descriptive message on invalid input
3. Define `SUPPORTED_SCHEMA_VERSIONS = ["1.0"]` and reject unrecognized versions

**Files**:
- `packages/settings-reconciler/src/manifest.ts` (extend, ~80 lines added)

**Validation**:
- [ ] Valid manifests pass validation
- [ ] Missing required fields throw descriptive errors
- [ ] Hook IDs without `joyus:` prefix are rejected
- [ ] Unknown schema versions are rejected
- [ ] Empty bundles object is accepted (revocation case)

---

### T004: Implement manifest fetching from URL

**Purpose**: Fetch a distribution manifest from the control plane API.

**Steps**:
1. In `manifest.ts`, implement:
   ```typescript
   async function fetchManifest(
     url: string,
     fetchImpl?: typeof fetch
   ): Promise<DistributionManifest>
   ```
2. Use `fetchImpl ?? fetch` for testability (same pattern as `distributionConfig.ts` in skill-sync)
3. On non-OK response: throw with status code
4. Parse JSON response, run through `validateManifest()`
5. Return validated manifest

**Files**:
- `packages/settings-reconciler/src/manifest.ts` (extend, ~20 lines added)

**Validation**:
- [ ] Successful fetch returns validated manifest
- [ ] Non-200 response throws with status code
- [ ] Invalid JSON in response throws
- [ ] Valid JSON that fails validation throws with descriptive error

---

### T005: Export public API from index.ts

**Purpose**: Set up the package's public API surface.

**Steps**:
1. In `packages/settings-reconciler/src/index.ts`, export:
   - All types from `manifest.ts` (HookEventType, SettingsTarget, ManifestHook, ManifestMcpServer, ManifestBundle, DistributionManifest)
   - Functions: `isValidManifest`, `validateManifest`, `fetchManifest`
   - `SUPPORTED_SCHEMA_VERSIONS`
2. Use `export { ... } from "./manifest"` pattern (re-exports, not barrel imports)

**Files**:
- `packages/settings-reconciler/src/index.ts` (~10 lines)

**Validation**:
- [ ] `pnpm typecheck` passes
- [ ] All exported names are accessible from the package

---

### T006: Tests for manifest module

**Purpose**: Achieve 100% coverage on the manifest module.

**Steps**:
1. Create `packages/settings-reconciler/test/manifest.test.ts`
2. Test `isValidManifest`:
   - Valid minimal manifest (empty bundles) → true
   - Valid full manifest (hooks + MCPs + config) → true
   - Missing schema_version → false
   - Missing tenant_id → false
   - Non-object bundles → false
   - Hook with missing id → false
   - Hook id without joyus: prefix → false
   - Hook with invalid event type → false
   - MCP server with missing command → false
   - Null/undefined/string/array input → false
3. Test `validateManifest`:
   - Valid input → returns manifest
   - Invalid input → throws Error with descriptive message
   - Unsupported schema version → throws
4. Test `fetchManifest`:
   - Successful fetch with valid JSON → returns manifest
   - Non-200 response → throws with status
   - Invalid JSON response → throws
   - Valid JSON but invalid manifest → throws with validation error
   - Inject mock fetch via fetchImpl parameter

**Files**:
- `packages/settings-reconciler/test/manifest.test.ts` (new, ~150 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% coverage on manifest.ts (lines, functions, branches, statements)

## Definition of Done

- [ ] `packages/settings-reconciler` exists with correct package.json, tsconfig.json
- [ ] All manifest types defined with readonly properties
- [ ] Manifest validation catches all invalid inputs with clear error messages
- [ ] Manifest fetching works with injectable fetch for testing
- [ ] Public API exports all types and functions
- [ ] `pnpm typecheck` passes
- [ ] `pnpm vitest run packages/settings-reconciler/` passes with 100% coverage

## Risks

- **Claude Code hook event types may change**: The HookEventType union is based on current observation. If new event types are added, the validation will reject them. Mitigation: validation should warn on unknown events rather than hard-reject (or use a loose string type with known-value helpers).

## Reviewer Guidance

- Verify readonly types match the contract definitions in `contracts/distribution-manifest.ts`
- Verify validation is exhaustive (every required field checked, every type guard correct)
- Verify fetch error handling matches the pattern in `packages/skill-sync/src/distributionConfig.ts`
- Verify package.json matches the conventions of existing packages (especially scripts, exports, type fields)

## Activity Log

- 2026-04-02T02:40:33Z – unknown – lane=in_progress – Dispatching to codex
