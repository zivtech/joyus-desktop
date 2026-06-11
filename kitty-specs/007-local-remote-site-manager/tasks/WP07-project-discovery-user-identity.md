---
work_package_id: WP07
title: Project Discovery & User Identity
dependencies:
- WP04
requirement_refs:
- FR-010
- FR-017
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T032
- T033
- T034
- T035
- T036
- T037
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: 'src/projectDiscovery.ts'
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- src/projectDiscovery.ts
- src/userIdentity.ts
- test/projectDiscovery.test.ts
- test/userIdentity.test.ts
tags: []
wp_code: WP07
---

# WP07: Project Discovery & User Identity

**Implement with**: `spec-kitty implement WP07 --base WP04`

## Objective

Implement chained project discovery (GitHub orgs + admin-curated list + manual URL entry) and user identity determination (internal vs. client) based on GitHub org membership or Google account domain.

## Context

- **FR-010**: Client users see only remote environments; internal users see everything
- **FR-017**: Chained discovery with deduplication
- **Identity signals**: GitHub org `zivtech` membership or `@zivtech.com` Google domain
- **Contracts**: See `contracts/environment-monitor.ts` — `ProjectDiscovery`, `UserIdentity`

## Subtasks

### T032: Implement `userIdentity.ts`

**Purpose**: Determine if the current user is internal (Zivtech) or a client.

**Steps**:
1. Implement `createUserIdentity(execCommand: ExecCommand)` factory:
   ```typescript
   getUserType(): Promise<UserType> {
     // Check GitHub org membership
     const { stdout } = await execCommand(['gh', 'api', '/user/orgs', '--jq', '.[].login']);
     const orgs = stdout.trim().split('\n').filter(Boolean);
     if (orgs.includes('zivtech')) return 'internal';

     // Check Google domain (via gh api for authenticated user email)
     const { stdout: emailOut } = await execCommand(['gh', 'api', '/user', '--jq', '.email // empty']);
     const email = emailOut.trim();
     if (email.endsWith('@zivtech.com')) return 'internal';

     return 'client';
   }
   ```
2. Cache the result — user type doesn't change during a session
3. Handle `gh` CLI not authenticated: return `'client'` as safe default, log a warning

**Files**: `packages/environment-monitor/src/userIdentity.ts` (~40 lines)

### T033: Implement `projectDiscovery.ts` — GitHub org discovery

**Purpose**: Discover repositories from GitHub organizations.

**Steps**:
1. Implement `createProjectDiscovery(execCommand, proboDetector)` factory
2. `discoverFromGitHubOrg(orgName)`:
   - Run `gh api "/orgs/{org}/repos?per_page=100&type=all" --jq '.[] | {clone_url, full_name}'`
   - Parse each repo: extract `repoOwner`, `repoName`, `repoUrl`
   - Return array of `DiscoveredProject` with `source: "github-org"`
   - Handle pagination if >100 repos (check `Link` header or use `--paginate`)
3. `hasProbo` and `hasDdev` are `undefined` at discovery time (checked later when repo is cloned)

**Files**: `packages/environment-monitor/src/projectDiscovery.ts` (~50 lines)

### T034: Implement admin-curated list stub

**Purpose**: Placeholder for joyus-ai platform API that returns curated project list.

**Steps**:
1. Add method `discoverFromAdminList()`:
   - For now: return empty array
   - Comment indicating this will call joyus-ai platform API when available
   - Accept an optional `apiBaseUrl` parameter for future use
2. Return type: `Promise<readonly DiscoveredProject[]>`

**Files**: `packages/environment-monitor/src/projectDiscovery.ts` (~10 lines)

### T035: Implement `discoverAll()` — combined discovery with deduplication

**Purpose**: Merge all discovery sources, deduplicate by repo URL, enrich with detection flags.

**Steps**:
1. `discoverAll()`:
   a. Call `discoverFromGitHubOrg('zivtech')` (hardcoded for now; configurable later)
   b. Call `discoverFromAdminList()`
   c. Combine results
   d. Deduplicate by normalizing `repoUrl` (strip `.git` suffix, lowercase)
   e. For duplicates, prefer the source with more info (admin-curated over github-org)
   f. Return deduplicated array
2. `addManual(repoUrl)`:
   - Parse owner/name from URL
   - Return `DiscoveredProject` with `source: "manual"`

**Files**: `packages/environment-monitor/src/projectDiscovery.ts` (~40 lines)

### T036: Write tests for `userIdentity.test.ts`

**Steps**:
1. Mock `ExecCommand` for `gh api` calls
2. Test: user in `zivtech` org → `'internal'`
3. Test: user not in `zivtech` org but has `@zivtech.com` email → `'internal'`
4. Test: user in other org with non-zivtech email → `'client'`
5. Test: `gh` not authenticated (exit code 1) → `'client'` (safe default)
6. Test: caching — `getUserType()` called twice, `gh api` called only once
7. Test: empty org list → falls through to email check

**Files**: `packages/environment-monitor/test/userIdentity.test.ts`

### T037: Write tests for `projectDiscovery.test.ts`

**Steps**:
1. Mock `ExecCommand` for `gh api` org repos
2. Test `discoverFromGitHubOrg()`: returns parsed projects with correct source
3. Test `discoverFromAdminList()`: returns empty array (stub)
4. Test `discoverAll()`: combines sources, deduplicates by URL
5. Test deduplication: same repo from two sources → one entry
6. Test URL normalization: `https://github.com/org/repo.git` and `https://github.com/org/repo` are the same
7. Test `addManual()`: parses owner/name from URL correctly
8. Test `addManual()` with various URL formats: HTTPS, SSH (`git@github.com:org/repo.git`)

**Files**: `packages/environment-monitor/test/projectDiscovery.test.ts`

## Definition of Done

- [ ] `userIdentity.ts` determines internal/client from GitHub org + Google domain
- [ ] `projectDiscovery.ts` discovers from GitHub org, admin list (stub), and manual URL
- [ ] Deduplication works correctly across sources
- [ ] Results cached appropriately
- [ ] All tests pass, 100% coverage
- [ ] Exported from `index.ts`

## Risks

- **GitHub org API permissions**: `gh api /user/orgs` may not return private org memberships unless the token has `read:org` scope. Document this as a setup requirement.
- **Pagination**: Large orgs (>100 repos) need pagination. Use `gh api --paginate` flag if available, or manual `page` parameter.

## Activity Log

- 2026-05-05T01:48:09Z – unknown – Pre-existing implementation on main — code verified, 360 tests passing
