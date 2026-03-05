# Feature Specification: Desktop Runtime Policy Enforcement

**Feature Branch**: `001-desktop-runtime-policy-enforcement`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User decision to execute a single private `joyus-desktop` repo with open-core compatibility and no desktop lock-in.

## Scope

### In Scope

- Desktop companion-side enforcement for policy decisions before privileged actions.
- Runtime routing logic: internal tenants may run local, external tenants require remote.
- Fail-closed behavior for policy outages on external medium/high-risk actions.
- Action authorization contract used by desktop components.
- CI-enforced full automated coverage (100% lines/functions/branches/statements).

### Out of Scope

- Full desktop screen recording.
- Multi-agent provider adapters beyond current MCP flow.
- Server-side policy engine implementation (belongs to `joyus-ai`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enforce Policy Before Privileged Actions (Priority: P1)

A desktop runtime must verify policy outcome before allowing a privileged action to execute.

**Why this priority**: This is the core trust boundary for desktop-mediated execution.

**Independent Test**: Unit tests validate allow/deny/escalate behavior for all outcome/risk combinations.

**Acceptance Scenarios**:

1. **Given** policy is available and returns `allow`, **When** desktop evaluates a low-risk action, **Then** action is allowed.
2. **Given** policy returns `deny`, **When** desktop evaluates an action, **Then** action is blocked.
3. **Given** policy returns `escalate`, **When** desktop evaluates an action, **Then** action is blocked pending approval.

---

### User Story 2 - Enforce Runtime Routing by Tenant Class (Priority: P1)

Desktop runtime must select execution target based on tenant class and policy.

**Why this priority**: External users must not bypass managed remote controls.

**Independent Test**: Unit tests validate runtime selection matrix.

**Acceptance Scenarios**:

1. **Given** tenant class is external, **When** runtime target is selected, **Then** target is always remote.
2. **Given** tenant class is internal and local execution is enabled, **When** runtime target is selected, **Then** target is local.
3. **Given** tenant class is internal and local execution is disabled, **When** runtime target is selected, **Then** target is remote.

---

### User Story 3 - Fail Closed on Policy Outage by Risk Tier (Priority: P1)

Desktop runtime must degrade safely when policy checks are unavailable.

**Why this priority**: Prevent unsafe execution during control-plane outages.

**Independent Test**: Unit tests validate outage behavior for each risk tier and tenant class.

**Acceptance Scenarios**:

1. **Given** external tenant and policy unavailable, **When** risk is medium or high, **Then** action is blocked (fail closed).
2. **Given** external tenant and policy unavailable, **When** risk is low, **Then** action may proceed in degraded mode.
3. **Given** internal tenant and policy unavailable, **When** risk is high, **Then** action is blocked.

---

### Edge Cases

- Empty or malformed policy decision token.
- Policy token with tenant, workspace, or action hash mismatch.
- Late-arriving policy response after action timeout.
- Local/remote routing disagreement between cached and fresh tenant metadata.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Desktop runtime MUST evaluate policy outcome before privileged action execution.
- **FR-002**: Desktop runtime MUST support `allow`, `deny`, and `escalate` policy outcomes.
- **FR-003**: Desktop runtime MUST require approval workflow when outcome is `escalate`.
- **FR-004**: Runtime target selection MUST force remote execution for external tenants.
- **FR-005**: Runtime target selection MUST support local execution for internal tenants when explicitly enabled.
- **FR-006**: On policy unavailability, desktop runtime MUST fail closed for external medium/high-risk actions.
- **FR-007**: On policy unavailability, desktop runtime MUST fail closed for internal high-risk actions.
- **FR-008**: Feature changes MUST include unit tests covering all branches of authorization and routing logic.
- **FR-009**: CI MUST enforce 100% line/function/branch/statement coverage for desktop runtime modules.

### Key Entities

- **Authorization Input**: Runtime structure containing risk level, policy availability, tenant class, and policy outcome.
- **Authorization Result**: Runtime decision containing allowed flag, approval requirement, and machine-readable reason.
- **Runtime Target**: Selected execution destination (`local` or `remote`) for an action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All authorization/routing/fail-closed branches are covered by automated tests.
- **SC-002**: CI fails on any coverage drop below 100% for desktop runtime modules.
- **SC-003**: External tenant tests demonstrate no local privileged execution path.
- **SC-004**: Policy outage tests demonstrate deterministic fail-closed behavior for defined risk tiers.

### Assumptions

- Server-side policy decision APIs and token issuance are implemented in `joyus-ai`.
- Desktop runtime consumes stable control-plane contracts and does not define server-side policy rules.
