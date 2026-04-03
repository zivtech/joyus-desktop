---
work_package_id: WP06
title: GitHub Deployment Status Poller
lane: planned
dependencies: [WP04]
requirement_refs: [FR-007, FR-015]
planning_base_branch: claude/channels-spec-005-amendment
merge_target_branch: claude/channels-spec-005-amendment
branch_strategy: Planning artifacts for this feature were generated on claude/channels-spec-005-amendment. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/channels-spec-005-amendment unless the human explicitly redirects the landing branch.
subtasks: [T026, T027, T028, T029, T030, T031]
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
---

# WP06: GitHub Deployment Status Poller

**Implement with**: `spec-kitty implement WP06 --base WP04`

## Objective

Implement the GitHub Deployments API poller that discovers Probo environment URLs via `gh api`, maps deployment states to `RemoteEnvironmentStatus`, and manages a background polling loop with event-driven triggers.

## Context

- **GitHub API**: Deployments API, not Check Runs. Environment URLs are on Deployment Status objects.
- **CLI**: Use `gh api` via `execFile` — no Octokit dependency
- **Polling**: 60-second interval + immediate trigger on push/PR events from Feature 006
- **Rate limits**: GitHub allows 5000 requests/hour authenticated. Back off on 403/rate-limit.
- **Reference**: `research.md` — Section 3 (GitHub Deployments API)

## Subtasks

### T026: Implement `deploymentStatusPoller.ts` — `pollForPr()`

**Purpose**: Query GitHub for deployment statuses associated with a PR.

**Steps**:
1. Implement `createDeploymentStatusPoller(execCommand: ExecCommand)` factory
2. `pollForPr(repoOwner, repoName, prNumber)`:
   a. Get PR head SHA:
      ```
      gh api repos/{owner}/{repo}/pulls/{pr_number} --jq '.head.sha'
      ```
   b. List deployments for that SHA:
      ```
      gh api "repos/{owner}/{repo}/deployments?sha={sha}&per_page=10"
      ```
   c. For each deployment, get the latest status:
      ```
      gh api "repos/{owner}/{repo}/deployments/{id}/statuses?per_page=1"
      ```
   d. Extract `state`, `environment_url`, `environment`, `description`
   e. Return array of `DeploymentStatusResult`
3. Parse all JSON responses, handle empty results gracefully

**Files**: `packages/environment-monitor/src/deploymentStatusPoller.ts` (~80 lines)

### T027: Implement deployment state mapping

**Purpose**: Map GitHub deployment states to `RemoteEnvironmentStatus`.

**Steps**:
1. Mapping function:
   ```typescript
   export function mapDeploymentState(ghState: string): RemoteEnvironmentStatus {
     switch (ghState) {
       case 'queued':
       case 'pending':
       case 'in_progress':
         return 'building';
       case 'success':
         return 'ready';
       case 'failure':
       case 'error':
         return 'failed';
       case 'inactive':
         return 'expired';
       default:
         return 'building'; // safe fallback for unknown states
     }
   }
   ```
2. Export for use by the environment monitor orchestrator

**Files**: `packages/environment-monitor/src/deploymentStatusPoller.ts` (~15 lines, within same file)

### T028: Implement polling loop

**Purpose**: Background 60-second polling for all tracked remote environments.

**Steps**:
1. Add to poller factory:
   - `startPolling()`: `setInterval` at 60000ms. On each tick:
     a. Get all `RemoteEnvironment` records with status `building` from the store
     b. For each, call `pollForPr()` with the stored repo/PR info
     c. Update store with new status and environment URL if changed
   - `stopPolling()`: `clearInterval`
2. Accept `RemoteEnvironmentStore` as a dependency so the poller can read/update records
3. Guard against concurrent polls (skip if previous poll still running)

**Files**: `packages/environment-monitor/src/deploymentStatusPoller.ts` (~40 lines)

### T029: Implement `triggerImmediatePoll()`

**Purpose**: Event-driven immediate poll when Feature 006 pushes/creates a PR.

**Steps**:
1. `triggerImmediatePoll(repoOwner, repoName, prNumber)`:
   - Call `pollForPr()` immediately (bypass interval)
   - Update store with results
   - Return void (fire-and-forget from caller's perspective)
2. Debounce: if called multiple times within 5 seconds for the same PR, only execute once

**Files**: `packages/environment-monitor/src/deploymentStatusPoller.ts` (~20 lines)

### T030: Implement rate limit handling

**Purpose**: Respect GitHub API rate limits gracefully.

**Steps**:
1. When `gh api` returns exit code 1 with stderr containing `"rate limit"` or `"API rate limit exceeded"`:
   - Parse `Retry-After` or `X-RateLimit-Reset` from error output if available
   - Set a backoff flag — skip polling until reset time
   - Log the rate limit event
2. When backoff is active:
   - `pollForPr()` returns empty results without making API calls
   - `triggerImmediatePoll()` is suppressed
   - After backoff expires, resume normal polling
3. Default backoff: 60 seconds if no header info available

**Files**: `packages/environment-monitor/src/deploymentStatusPoller.ts` (~30 lines)

### T031: Write tests for `deploymentStatusPoller.test.ts`

**Steps**:
1. Mock `ExecCommand` to return `gh api` JSON responses
2. Test `pollForPr()`:
   - PR with deployment + successful status → returns environment URL
   - PR with deployment + in_progress status → returns building
   - PR with no deployments → returns empty array
   - PR not found → returns empty array (graceful)
3. Test state mapping: all 7 GitHub states map correctly
4. Test polling loop: verify `setInterval` called, poll executes, `stopPolling` clears interval
5. Test `triggerImmediatePoll()`: bypasses interval, debounce prevents duplicate calls
6. Test rate limit: mock 403 response → backoff activated → polls suppressed → backoff expires → polls resume
7. Test concurrent poll guard: second tick skipped while first is running

**Files**: `packages/environment-monitor/test/deploymentStatusPoller.test.ts`

## Definition of Done

- [ ] `pollForPr()` queries GitHub Deployments API via `gh api` and extracts environment URLs
- [ ] State mapping covers all GitHub deployment states
- [ ] 60-second polling loop with concurrent-poll guard
- [ ] Immediate poll trigger with debounce
- [ ] Rate limit detection and backoff
- [ ] All tests pass, 100% coverage

## Risks

- **Probo environment name**: Probo may use a non-standard `environment` field (e.g., `"probo-build-42"` vs `"preview"`). The poller should accept any environment name, not filter by a specific string.
- **`gh` CLI not installed**: If `gh` is not in PATH, all polls will fail. The poller should detect this once on startup and surface a clear error.
