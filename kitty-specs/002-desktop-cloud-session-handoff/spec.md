# Feature Specification: Desktop-to-Cloud Session Handoff

**Feature Branch**: `002-desktop-cloud-session-handoff`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User-initiated transfer of an active desktop session to the cloud so work can continue from another device.

## Scope

### In Scope

- User-initiated handoff trigger from the desktop companion to the cloud control plane.
- Policy authorization of the handoff as a privileged action via `verify_before_action`.
- Full session snapshot assembly: session identity, conversation history, pending action queue, runtime configuration, cached policy decisions, and output artifacts.
- End-to-end encryption of the session snapshot before it leaves the desktop, with integrity verification.
- Encrypted snapshot transfer to the cloud control plane.
- Cloud-side session pickup that reconstructs full session state from the transferred snapshot.
- Control-plane contract definitions for handoff initiation and cloud session creation (no desktop lock-in).

### Out of Scope

- Local session lifecycle after handoff (suspend, terminate, resume) — deferred to follow-up.
- System-initiated or automatic session migration.
- Multi-device simultaneous session (two active views of the same session).
- Server-side policy engine changes (belongs to `joyus-ai`).

### Fast Follow-Up

- **Cloud-to-desktop reverse handoff**: Allowing a user to transfer an active cloud session back to a local desktop runtime. Should reuse the same snapshot format and policy authorization flow defined here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Initiate Session Handoff from Desktop (Priority: P1)

A desktop user decides to continue their session from another device and triggers a handoff to the cloud.

**Why this priority**: This is the entry point for the entire feature; nothing else works without it.

**Independent Test**: Unit tests validate that a handoff request is constructed with the correct session snapshot and submitted to the control plane.

**Acceptance Scenarios**:

1. **Given** a user has an active local session, **When** they trigger a handoff, **Then** the desktop assembles a full session snapshot and requests policy authorization.
2. **Given** the policy check returns `allow`, **When** the snapshot is assembled, **Then** the desktop transmits the snapshot to the cloud control plane.
3. **Given** the policy check returns `deny`, **When** the user triggers a handoff, **Then** the handoff is blocked and the user is informed with the denial reason.
4. **Given** the policy check returns `escalate`, **When** the user triggers a handoff, **Then** the handoff is blocked pending approval.

---

### User Story 2 — Cloud Pickup of Transferred Session (Priority: P1)

After a successful handoff, a user opens the cloud interface and resumes their session with full context.

**Why this priority**: Without cloud pickup, the handoff is a dead end.

**Independent Test**: Unit tests validate that a cloud session is reconstructed from a received snapshot with all state intact.

**Acceptance Scenarios**:

1. **Given** a valid snapshot has been transferred, **When** the user accesses the cloud session, **Then** conversation history is fully available.
2. **Given** a valid snapshot has been transferred, **When** the user accesses the cloud session, **Then** pending actions from the desktop session are visible and resumable.
3. **Given** a valid snapshot has been transferred, **When** the user accesses the cloud session, **Then** runtime configuration and cached policy decisions are restored.
4. **Given** a snapshot with output artifacts, **When** the user accesses the cloud session, **Then** all artifacts are accessible.

---

### User Story 3 — Policy-Gated Handoff Authorization (Priority: P1)

The handoff must pass a policy check as a privileged action before any session data leaves the desktop.

**Why this priority**: Security-first enforcement per constitution principle 2.3.

**Independent Test**: Unit tests validate that handoff is treated as a medium/high-risk action and blocked when policy is unavailable.

**Acceptance Scenarios**:

1. **Given** the handoff action is classified as medium-risk, **When** policy is available, **Then** the `verify_before_action` flow is invoked with tenant/workspace/session binding.
2. **Given** policy is unavailable for an external tenant, **When** handoff is attempted, **Then** the handoff fails closed.
3. **Given** policy is unavailable for an internal tenant, **When** handoff is attempted, **Then** the handoff fails closed (session data leaving the device is a sensitive operation regardless of tenant class).

---

### User Story 4 — Snapshot Integrity Verification (Priority: P2)

The cloud must verify that the received snapshot is complete and untampered before creating a session from it.

**Why this priority**: Prevents corrupted or partial state from producing a broken cloud session.

**Independent Test**: Unit tests validate checksum/signature verification and rejection of malformed snapshots.

**Acceptance Scenarios**:

1. **Given** a snapshot with a valid integrity signature, **When** the cloud receives it, **Then** the session is created.
2. **Given** a snapshot with a mismatched checksum, **When** the cloud receives it, **Then** the snapshot is rejected and the user is notified.
3. **Given** a snapshot missing required fields, **When** the cloud receives it, **Then** the snapshot is rejected with a specific error identifying the missing data.

---

### Edge Cases

- Handoff triggered while a privileged action is mid-execution on the desktop.
- Network interruption during snapshot transfer (partial upload): desktop automatically retries up to a defined limit; if retries exhaust, falls back to resumable transfer so the upload can continue from where it left off.
- Policy decision token expiring between authorization and snapshot transmission.
- Snapshot size exceeding transfer limits (large conversation history or many artifacts).
- Concurrent handoff attempts from the same session.
- Tenant/workspace mismatch between the desktop session and the cloud target environment.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Desktop runtime MUST provide a programmatic API (`executeHandoff()`) to initiate session handoff. The UI trigger (button/command) that invokes this API is an integration concern outside this feature's scope.
- **FR-002**: Handoff initiation MUST trigger a policy authorization check via `verify_before_action` before any session data is transmitted.
- **FR-003**: The handoff action MUST be classified at minimum as medium-risk for policy evaluation.
- **FR-004**: On policy denial or escalation, the handoff MUST be blocked and the user informed with the reason.
- **FR-005**: On policy unavailability, the handoff MUST fail closed regardless of tenant class.
- **FR-006**: The session snapshot MUST include: session identity (session ID, tenant ID, workspace ID), conversation history, pending action queue, runtime configuration, cached policy decisions, and output artifacts.
- **FR-007**: The snapshot MUST be encrypted end-to-end before leaving the desktop; only the authorized cloud recipient may decrypt it.
- **FR-007a**: The snapshot MUST include an integrity signature that the cloud side can verify after decryption.
- **FR-008**: The cloud control plane MUST expose a contract for receiving and validating a session snapshot.
- **FR-009**: The cloud MUST reject snapshots that fail integrity verification.
- **FR-010**: The cloud MUST reconstruct a fully functional session from a valid snapshot, preserving all transferred state.
- **FR-011**: The handoff contract MUST be defined as a documented control-plane interface (no desktop lock-in, per constitution principle 2.2).
- **FR-012**: Feature changes MUST include unit tests covering all handoff, policy, and snapshot verification branches.
- **FR-013**: CI MUST enforce 100% line/function/branch/statement coverage for handoff modules.
- **FR-014**: On network interruption during snapshot transfer, the desktop MUST automatically retry up to a defined limit.
- **FR-015**: If automatic retries are exhausted, the desktop MUST fall back to resumable transfer, continuing from the last successfully transferred position.

### Key Entities

- **Session Snapshot**: Serialized bundle containing session identity, conversation history, pending actions, runtime configuration, cached policy decisions, output artifacts, and an integrity signature.
- **Handoff Request**: Control-plane message initiating a session transfer, containing the policy authorization token and the session snapshot.
- **Handoff Receipt**: Cloud-side acknowledgement containing the new cloud session identifier and status.
- **Handoff Policy Action**: The privileged action descriptor submitted to `verify_before_action` for handoff authorization.
- **Handoff States**: A handoff progresses through the following states: `initiated`, `authorizing`, `encrypting`, `transferring`, `completed`, `failed`. Valid transitions between states are deferred to the planning phase.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can initiate a handoff from desktop and resume the identical session in the cloud within 30 seconds for typical session sizes (defined as <10 MiB manifest + artifacts; maximum supported: 100 MiB).
- **SC-002**: 100% of handoff attempts are policy-gated — no session data leaves the desktop without an `allow` decision.
- **SC-002a**: 100% of transferred snapshots are encrypted end-to-end — no plaintext session data traverses the network.
- **SC-003**: Cloud sessions created from handoff contain all conversation history, pending actions, and artifacts from the desktop session.
- **SC-004**: Corrupted or incomplete snapshots are rejected 100% of the time with actionable error messages.
- **SC-005**: All handoff, policy, and integrity branches are covered by automated tests with 100% coverage enforced by CI.

## Clarifications

### Session 2026-03-09

- Q: Should the spec require end-to-end encryption of the snapshot during transfer? → A: Yes, snapshot must be encrypted end-to-end before leaving the desktop.
- Q: What should happen on network interruption during transfer? → A: Automatic retry first; if retries exhaust, fall back to resumable transfer (continue from last successful position).
- Q: Should the spec define a formal handoff state machine? → A: Define states at spec level (initiated, authorizing, encrypting, transferring, completed, failed); defer transition rules to planning.

### Assumptions

- Server-side policy decision APIs and token issuance are implemented in `joyus-ai` (same assumption as feature 001).
- The cloud control plane can accept and store session snapshots via a documented contract.
- Desktop runtime has access to all session state components needed for snapshot assembly.
- Feature 001 (runtime policy enforcement) is implemented and available for reuse.
