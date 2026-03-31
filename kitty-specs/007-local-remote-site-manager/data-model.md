# Data Model: Feature 007 — Local & Remote Site Manager

**Date**: 2026-03-31

## Package: `packages/local-provisioner`

### LocalSite

Persisted in SQLite (`~/.joyus/local-provisioner.db`).

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK, UUID | Unique identifier |
| `project_name` | TEXT | NOT NULL | Human-readable project name |
| `repo_url` | TEXT | NOT NULL | Git repository URL |
| `repo_path` | TEXT | NOT NULL | Absolute path to cloned repo on disk |
| `ddev_project_name` | TEXT | NOT NULL | DDEV project name (from `.ddev/config.yaml`) |
| `http_url` | TEXT | | Local HTTP URL (e.g., `http://mysite.ddev.site`) |
| `https_url` | TEXT | | Local HTTPS URL |
| `status` | TEXT | NOT NULL, CHECK IN ('running','stopped','starting','error') | Current lifecycle state |
| `error_message` | TEXT | | Plain-language error description when status='error' |
| `project_type` | TEXT | | CMS type from DDEV (e.g., `drupal10`, `wordpress`) |
| `created_at` | INTEGER | NOT NULL | Unix timestamp ms |
| `last_activity_at` | INTEGER | NOT NULL | Unix timestamp ms |
| `deleted_at` | INTEGER | | Soft delete timestamp |

**Indexes**:
- `UNIQUE idx_local_sites_repo_path ON (repo_path) WHERE deleted_at IS NULL`
- `idx_local_sites_status ON (status) WHERE deleted_at IS NULL`

**State transitions**:
- `stopped` → `starting` → `running` (on `ddev start`)
- `running` → `stopped` (on `ddev stop`)
- Any → `error` (on failure)
- `error` → `starting` (on retry)

### RuntimeCheckResult (in-memory, not persisted)

| Field | Type | Description |
|---|---|---|
| `dockerInstalled` | boolean | Whether a container runtime is detected |
| `dockerRunning` | boolean | Whether the Docker API responds to ping |
| `dockerProvider` | string or undefined | `"docker-desktop"`, `"orbstack"`, or undefined |
| `dockerVersion` | string or undefined | Engine version string |
| `socketPath` | string or undefined | Resolved socket/pipe path |
| `ddevInstalled` | boolean | Whether `ddev` is in PATH |
| `ddevVersion` | string or undefined | DDEV version string |
| `ddevDockerPlatform` | string or undefined | DDEV's reported docker_platform |
| `systemCpus` | number or undefined | From Docker `/info` |
| `systemMemoryBytes` | number or undefined | From Docker `/info` |

---

## Package: `packages/environment-monitor`

### RemoteEnvironment

Persisted in SQLite (`~/.joyus/environment-monitor.db`).

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK, UUID | Unique identifier |
| `repo_owner` | TEXT | NOT NULL | GitHub repo owner |
| `repo_name` | TEXT | NOT NULL | GitHub repo name |
| `environment_type` | TEXT | NOT NULL, CHECK IN ('probo','joyus-ai-hosted') | Provisioning strategy |
| `pr_number` | INTEGER | | Associated PR number (null for joyus-ai-hosted without PR) |
| `pr_url` | TEXT | | GitHub PR URL |
| `pr_title` | TEXT | | PR title (used as display label) |
| `deployment_id` | INTEGER | | GitHub Deployment ID |
| `environment_url` | TEXT | | Preview environment URL |
| `status` | TEXT | NOT NULL, CHECK IN ('building','ready','failed','expired','provisioning') | Current state |
| `task_branch_id` | TEXT | | FK reference to session-manager's TaskBranch.id |
| `error_message` | TEXT | | Plain-language error on failure |
| `last_checked_at` | INTEGER | NOT NULL | Unix timestamp ms of last status poll |
| `created_at` | INTEGER | NOT NULL | Unix timestamp ms |
| `deleted_at` | INTEGER | | Soft delete timestamp |

**Indexes**:
- `UNIQUE idx_remote_envs_deployment ON (deployment_id) WHERE deleted_at IS NULL AND deployment_id IS NOT NULL`
- `idx_remote_envs_repo ON (repo_owner, repo_name) WHERE deleted_at IS NULL`
- `idx_remote_envs_task_branch ON (task_branch_id) WHERE deleted_at IS NULL AND task_branch_id IS NOT NULL`
- `idx_remote_envs_status ON (status) WHERE deleted_at IS NULL`

**State transitions (Probo)**:
- `building` → `ready` (deployment status `success` + `environment_url` present)
- `building` → `failed` (deployment status `failure` or `error`)
- `ready` → `expired` (PR merged/closed, deployment status `inactive`)

**State transitions (joyus-ai-hosted)**:
- `provisioning` → `ready` (API reports environment up)
- `provisioning` → `failed` (API error)
- `ready` → `expired` (TTL exceeded, API reports teardown)

### ActivityLogEntry

Persisted in SQLite (`~/.joyus/environment-monitor.db`, same database).

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK, UUID | Unique identifier |
| `repo_owner` | TEXT | | GitHub repo owner (null for non-repo events) |
| `repo_name` | TEXT | | GitHub repo name |
| `event_type` | TEXT | NOT NULL, CHECK IN ('push','pr_created','env_building','env_ready','env_failed','env_expired','site_started','site_stopped','site_error','runtime_installed','error') | Event classification |
| `description` | TEXT | NOT NULL | Plain-language event description |
| `metadata` | TEXT | | JSON blob for event-specific data |
| `created_at` | INTEGER | NOT NULL | Unix timestamp ms |

**Indexes**:
- `idx_activity_log_repo ON (repo_owner, repo_name, created_at DESC)`
- `idx_activity_log_created ON (created_at DESC)`

**Retention**: Entries older than 30 days are pruned on app startup.

---

## Cross-Package Relationships

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  session-manager     │     │ environment-monitor   │     │ local-provisioner   │
│  (Feature 006)       │     │ (Feature 007)         │     │ (Feature 007)       │
│                      │     │                       │     │                      │
│  TaskBranch ─────────┼──── │ RemoteEnvironment     │     │  LocalSite           │
│    .id               │  ←──┤   .task_branch_id     │     │    (independent)     │
│    .prNumber  ───────┼──── │   .pr_number          │     │                      │
│    .prUrl            │     │   .environment_url    │     │                      │
│    .prStatus         │     │   .status             │     │                      │
└─────────────────────┘     └──────────────────────┘     └─────────────────────┘
```

- `RemoteEnvironment.task_branch_id` references `TaskBranch.id` by value (not a DB-level FK — separate databases). Correlation happens in application code.
- `RemoteEnvironment.pr_number` aligns with `TaskBranch.prNumber` for lookup when `task_branch_id` is unknown.
- `LocalSite` is independent of `TaskBranch` — a local site can exist without a git session.
