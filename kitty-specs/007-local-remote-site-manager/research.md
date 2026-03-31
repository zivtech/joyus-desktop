# Research: Feature 007 — Local & Remote Site Manager

**Date**: 2026-03-31
**Feature**: 007-local-remote-site-manager

## Decision Log

### 1. Docker/OrbStack Runtime Detection

**Decision**: Use Docker Engine API over Unix socket (macOS) / named pipe (Windows) for runtime detection and health checks. Shell out to DDEV CLI for all site operations.

**Rationale**: The Docker Engine API provides reliable, structured liveness checks (`GET /_ping`) and system info (`GET /info`) without depending on DDEV being installed. DDEV has no programmatic API — its CLI with `-j` JSON output is the only stable interface.

**Alternatives considered**:
- Shell out to `docker info` CLI: works but less structured, slower, and conflates detection with DDEV concerns
- `dockerode` npm package: adds a dependency for what amounts to 3 HTTP calls; raw `http.request` with `socketPath` is sufficient on macOS, and a small named-pipe adapter handles Windows

**Key findings**:

Socket detection priority (macOS):
1. `DOCKER_HOST` env var (overrides all)
2. `$HOME/.docker/run/docker.sock` (Docker Desktop 4.0+)
3. `$HOME/.orbstack/run/docker.sock` (OrbStack)
4. `/var/run/docker.sock` (legacy symlink)

Socket detection (Windows):
1. `DOCKER_HOST` env var
2. `\\.\pipe\docker_engine` (named pipe)

API calls needed:
- `GET /_ping` — liveness probe (200 OK = running)
- `GET /info` — `ServerVersion`, `NCPU`, `MemTotal`, `Containers`, `ContainersRunning`
- `GET /containers/{id}/stats?stream=false` — per-container CPU/memory snapshot
- `GET /containers/json` — list running containers with `Id`, `Names`, `State`

CPU % formula: `((cpu_delta) / (system_delta)) * online_cpus * 100`

### 2. DDEV CLI Automation

**Decision**: Shell out to DDEV CLI with `-j` (JSON output) flag for all site operations. Parse the standard envelope (`{ msg, level, raw }`) for structured data.

**Rationale**: DDEV's CLI is the only supported interface. The `-j` flag is a global flag available on all commands, providing machine-readable output with consistent envelope format.

**Key commands and JSON fields**:

| Command | Key `raw` fields |
|---|---|
| `ddev version -j` | `ddev_version`, `docker_platform`, `docker_version` |
| `ddev list -j` | Array of `{ name, status, approot, httpurl, httpsurl, type }` |
| `ddev describe -j <name>` | `name`, `status`, `httpurl`, `httpsurl`, `services`, `dbinfo` |
| `ddev start <name>` | Exit 0 = success |
| `ddev stop <name>` | Exit 0 = success |
| `ddev delete -O -y <name>` | Exit 0 = success (skip snapshot + confirmation) |

**Error classification** (all return exit code 1):
- Docker not running: `"Is the Docker daemon running?"`
- Port conflict: `"port is already allocated"` or `"address already in use"`
- Missing config: `"is not a valid DDEV project"`
- Project not found: `"project ... does not exist"`

**Installation**:
- macOS: `brew install ddev/ddev/ddev`
- Windows: `choco install ddev` or `winget install ddev.ddev`
- Detection: `command -v ddev` then `ddev version -j`

**Runtime auto-detection**: DDEV auto-detects the active Docker provider via the Docker socket. Reports the provider in `ddev version -j` → `raw.docker_platform` (e.g., `"orbstack"`, `"docker desktop"`).

### 3. GitHub Deployments API (Probo Environment URLs)

**Decision**: Use `gh api` to query GitHub Deployments API for Probo preview environment URLs. Poll deployments by PR head SHA, read `environment_url` from the latest successful deployment status.

**Rationale**: Deployments and Deployment Statuses are the GitHub mechanism for preview environment URLs. Probo creates both a Deployment and Deployment Status objects. The `environment_url` field on the status contains the preview URL.

**Alternatives considered**:
- Octokit SDK: adds a dependency; `gh api` with `--jq` provides the same data with zero new deps
- Check Runs API: separate concept — Check Runs report CI test results, Deployments report environment URLs. They share the same commit SHA but are independent objects.

**API flow to discover Probo URL for a PR**:

1. Get PR head SHA: `gh pr view <number> --json headRefOid --jq '.headRefOid'`
2. List deployments for that SHA: `gh api "repos/{owner}/{repo}/deployments?sha=<SHA>"`
3. Get statuses for deployment: `gh api "repos/{owner}/{repo}/deployments/<id>/statuses"`
4. Read `environment_url` from the first status with `state: "success"`

**Deployment Status states**: `queued`, `pending`, `in_progress`, `success`, `failure`, `error`, `inactive`

**Mapping to SiteStatus**:
- `queued` / `pending` / `in_progress` → `building`
- `success` → `ready` (with `environment_url`)
- `failure` / `error` → `failed`
- `inactive` → `expired`

**Polling strategy**: Event-driven (immediate check when Feature 006 pushes/creates PR) + 60-second fallback polling. Respect GitHub API rate limits (5000/hour authenticated).

### 4. Probo Detection

**Decision**: Check for `.probo.yaml` in the repository root to determine Probo availability.

**Rationale**: Simple filesystem check after clone. No API calls needed. If the file exists, Probo is configured for the repo.

### 5. User Identity (Internal vs. Client)

**Decision**: Use GitHub org membership (`zivtech`) or Google account domain (`@zivtech.com`) to determine internal status. All others treated as client users.

**Rationale**: Leverages existing authentication signals without requiring the joyus-ai platform user model (not yet built). `gh api /user/orgs --jq '.[].login'` checks org membership.

### 6. Project Discovery

**Decision**: Chained progressive discovery — GitHub org repos + admin-curated list from joyus-ai platform + manual git URL entry.

**Rationale**: Multiple sources ensures flexibility. GitHub org repos cover most Zivtech projects automatically. Admin list handles curated/priority projects. Manual URL is the escape hatch.

**Implementation**: `gh api /orgs/zivtech/repos --jq '.[].clone_url'` for org repos. joyus-ai platform API (future) for curated list. Manual URL input as fallback.
