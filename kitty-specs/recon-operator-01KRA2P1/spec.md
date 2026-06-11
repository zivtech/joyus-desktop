# Feature Specification: Recon Operator

**Mission**: `recon-operator-01KRA2P1`
**Created**: 2026-05-10
**Status**: Draft
**Planning Source**: `joyus-ai-internal/planning/recon-operator-readiness-plan-v2.md`

## Problem Statement

Joyus Recon is a site-analysis tool that produces Architecture Reference Documents, competitive analysis, and pre-drafted project specifications for prospective client engagements. Today it requires Terminal expertise to operate — the user must configure environment variables, invoke CLI commands, and manage output files manually. This limits Recon to a single developer (Alex) and prevents the broader team from using it during the RFP/discovery phase of client engagements.

The operator, a non-technical Zivtech operator, needs to run Recon engagements independently. He is comfortable with Mac desktop applications but does not use Terminal. The gap between Recon's current CLI-only interface and the operator's workflow blocks the team from scaling site-analysis to more client opportunities.

## Vision

The operator launches the Desktop app, enters a client name and URL, clicks "Start," and receives a gated, credential-free export of the engagement results — without ever opening a terminal window. Desktop handles everything behind the scenes: credential management, tool invocation, progress monitoring, output safety scanning, and export packaging.

## Actors

| Actor | Description | Technical Level |
|-------|------------|-----------------|
| Operator (the operator) | Runs Recon engagements against prospective client sites | Non-technical; uses Mac apps, not Terminal |
| Administrator (Alex) | Sets up operator machines, provides credentials, manages tool updates | Developer; full CLI access |
| Analysis Tool | Background process that executes the multi-phase site analysis | Automated; invoked by Desktop |

## User Scenarios & Acceptance Flows

### Scenario 1: First-Time Setup

**Actor**: Operator (with Administrator remote assistance for initial setup only)

1. Operator receives the Desktop application package from Administrator
2. Operator installs the application on their Mac
3. On first launch, Desktop detects no prior setup and presents a guided wizard
4. Wizard Step 1: Desktop checks whether the required analysis CLI tool is installed. If missing, shows installation instructions. Operator confirms installation.
5. Wizard Step 2: Operator enters API credentials (provided by Administrator via secure channel). Desktop validates each credential against its respective service. Visual pass/fail indicator per credential.
6. Wizard Step 3: Desktop verifies the analysis skill file is installed in the expected location. Shows status.
7. Setup complete. Desktop shows main engagement screen.

**Acceptance**: Operator completes setup in under 30 minutes (including any assisted CLI tool installation). All credentials validated. Wizard does not proceed past a step until it passes.

### Scenario 2: Running an Engagement

**Actor**: Operator (unassisted)

1. Operator clicks "New Engagement" on the main screen
2. Operator enters: client name, website URL, access mode (RFP / Discovery / Full)
3. Operator clicks "Start Engagement"
4. Desktop creates an engagement workspace, launches the analysis tool in the background with injected credentials
5. Desktop shows a progress panel: current phase, elapsed time, recent activity
6. Operator can leave Desktop running and work on other tasks
7. When the analysis completes, Desktop detects completion and updates the status
8. Desktop automatically scans the output for sensitive content (leaked credentials, internal URLs, API keys)
9. If scan passes: "Export" button becomes available. Operator clicks to download a clean zip.
10. If scan finds issues: Desktop shows findings with file/line detail. Operator can review and override (with audit log) or redact and re-export.

**Acceptance**: Operator completes the flow from "New Engagement" to "Export" in under 5 minutes of hands-on time (excluding analysis execution time). No credential appears in the exported archive.

### Scenario 3: Credential Update

**Actor**: Operator

1. Administrator provides new credentials via secure channel
2. Operator opens Desktop settings / credential management
3. Operator updates the changed credential
4. Desktop validates the new credential
5. Next engagement uses updated credential automatically

**Acceptance**: Credential update takes under 2 minutes. Old credential is fully replaced.

### Scenario 4: Error Recovery

**Actor**: Operator

1. Engagement runs for over 2 hours with no completion
2. Desktop shows a "may be stuck" alert with options: check status, mark as failed, keep waiting
3. Operator marks as failed
4. Operator can start a new engagement for the same client

**Acceptance**: Operator is never in an unrecoverable state. Every error has an actionable next step.

### Scenario 5: Application Update

**Actor**: Operator

1. Administrator publishes a new version of Desktop
2. On next launch, Desktop detects the update and prompts to install
3. Operator accepts the update
4. Desktop restarts with the new version; all credentials and history preserved

**Acceptance**: Update completes without data loss. No re-entry of credentials required.

## Functional Requirements

| ID | Requirement | Status |
|----|------------|--------|
| FR-001 | Desktop shall create an engagement workspace directory with required template files given a client name, URL, and access mode | Approved |
| FR-002 | Desktop shall launch the analysis tool as a background process, injecting stored credentials as environment variables, without displaying a terminal window to the operator | Approved |
| FR-003 | Desktop shall display real-time progress from the background analysis process, showing at minimum the current phase and elapsed time | Approved |
| FR-004 | Desktop shall detect analysis completion via process exit monitoring, with an optional metadata file as a backup signal | Approved |
| FR-005 | The analysis skill shall write a machine-readable completion sentinel containing status, timestamp, and output file list to the engagement workspace upon completion | Approved |
| FR-006 | Desktop shall scan engagement output for sensitive content (credentials, API keys, internal URLs) before allowing export | Approved |
| FR-007 | Desktop shall create an export archive of engagement results, excluding credential files, metadata files, and temporary artifacts | Approved |
| FR-008 | Desktop shall store operator credentials securely on the local machine, with read access restricted to the current user | Approved |
| FR-009 | Desktop shall validate stored credentials against their respective services before allowing engagement launch | Approved |
| FR-010 | Desktop shall present a first-run setup wizard that guides the operator through prerequisite installation, credential entry, and skill verification | Approved |
| FR-011 | Desktop shall migrate credential storage from file-based to OS-native secret storage, preserving all existing credentials without operator intervention | Approved |
| FR-012 | Desktop shall automatically sync the analysis skill from a version-pinned distribution source, keeping the operator's skill file up to date | Approved |
| FR-013 | Desktop shall verify skill version consistency before launching an engagement, auto-syncing on version mismatch | Approved |
| FR-014 | Desktop shall be distributed as a signed and notarized application package that installs without OS security warnings | Approved |
| FR-015 | Desktop shall display a readiness matrix before engagement launch showing the status of all prerequisites (CLI tool, credentials, skill, service connectivity) | Approved |
| FR-016 | Desktop shall handle engagement timeout (2+ hours), crash recovery (incomplete engagements on relaunch), and scan override (with audit log) | Approved |

## Non-Functional Requirements

| ID | Requirement | Threshold | Status |
|----|------------|-----------|--------|
| NFR-001 | First-run setup shall complete within 30 minutes including any assisted prerequisite installation | ≤ 30 minutes | Approved |
| NFR-002 | Per-engagement operator overhead (from "New Engagement" click to "Export" click) shall not exceed 5 minutes, excluding analysis execution time | ≤ 5 minutes hands-on | Approved |
| NFR-003 | Completion detection shall occur within 5 seconds of the analysis process finishing | ≤ 5 seconds | Approved |
| NFR-004 | Readiness matrix preflight check shall complete within 5 seconds | ≤ 5 seconds | Approved |
| NFR-005 | Exported archives shall contain zero credential or secret values under all tested scenarios | 0 leaked credentials | Approved |
| NFR-006 | Credential storage shall be readable only by the current OS user account | OS-enforced access control | Approved |
| NFR-007 | Application updates shall preserve all credentials and engagement history | Zero data loss on update | Approved |

## Constraints

| ID | Constraint | Status |
|----|-----------|--------|
| C-001 | macOS only for the initial release. Windows and Linux are out of scope. | Approved |
| C-002 | Single operator per machine. Multi-user provisioning is out of scope. | Approved |
| C-003 | The analysis tool (Claude Code CLI) must be pre-installed on the operator's machine; Desktop assists but does not bundle it. | Approved |
| C-004 | API credentials (DataForSEO, Anthropic, Google CrUX/PageSpeed) are provided by the Administrator via a secure out-of-band channel. | Approved |
| C-005 | Per-engagement analysis cost shall be capped at a configurable maximum (default $25) to prevent runaway API charges. | Approved |
| C-006 | The analysis skill file is the single-source-of-truth for engagement behavior; Desktop does not modify or extend it beyond version management. | Approved |

## Phasing

### Phase 1: Minimum Viable Dogfood (Weeks 1-2)

Deliver the core engagement lifecycle: setup wizard, credential storage (file-based with filesystem permissions), engagement creation, background process launch with progress streaming, completion detection, output scanning, and gated export.

**Gate**: the operator can launch a Recon engagement from Desktop UI, see it running, and export gated results.

### Phase 2: Secure Credentials & Automatic Updates (Weeks 3-4)

Upgrade credential storage to OS-native secret management. Add automatic skill syncing with version pinning. Migrate existing credentials without operator intervention.

**Gate**: Credentials at rest in OS secret store only. Skill auto-synced. Zero credential files on disk during execution.

### Phase 3: Signed Distribution & Unassisted Operation (Weeks 5-6)

Sign and notarize the application package. Add readiness matrix, error recovery UX, and comprehensive error handling. Run the operator's unassisted UAT.

**Gate**: the operator completes an unassisted engagement. Signed distribution installs without security warnings.

## Assumptions

| # | Assumption | Confidence | Risk if Wrong |
|---|-----------|-----------|--------------|
| A1 | the operator uses a personal Mac not shared with other users | Reasonable | File-based credential security model is insufficient |
| A2 | The analysis CLI supports non-interactive invocation with credential injection and streaming output | Verified (2026-05-10) | Delegation model fundamentally broken |
| A3 | The analysis skill can be modified to write a completion sentinel | Verified (2026-05-10) | Must rely on process exit as sole completion signal |
| A4 | OS secret storage works without application signing (with user confirmation prompts) | Reasonable | Constant permission prompts degrade UX until signing |
| A5 | Third-party API balance is sufficient for dogfood engagements ($5-15 per run) | Fragile | Analysis fails mid-run with payment errors |
| A6 | Desktop's existing application package format works on the operator's machine | Reasonable | May need architecture-specific build |

## Success Criteria

1. the operator completes a full engagement cycle — from opening the application to exporting results — without using Terminal commands (after initial assisted setup)
2. Total setup time for a new operator is under 30 minutes
3. Per-engagement hands-on time is under 5 minutes (excluding analysis execution)
4. Zero credential values appear in any exported archive across all test runs
5. the operator rates the experience at least 3/5 for usability
6. Every error state encountered during UAT has an actionable recovery path in the UI

## Dependencies

- Analysis CLI tool installed on operator machine (external prerequisite)
- Third-party API accounts with valid credentials and sufficient balance (DataForSEO, Anthropic, Google)
- Analysis skill file available for distribution (maintained in separate repository)
- Apple Developer certificate for signed distribution (Phase 3, external)

## Out of Scope

- Windows or Linux support
- Multi-user provisioning or role-based access
- Auto-update beyond the existing application update mechanism
- Production hosting of analysis APIs
- CMS enrichment integration
- Modifying the analysis skill's behavior (Desktop manages distribution, not content)
