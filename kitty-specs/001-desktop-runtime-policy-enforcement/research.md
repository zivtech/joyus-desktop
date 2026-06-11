# Research: Desktop Runtime Policy Enforcement

**Feature**: 001-desktop-runtime-policy-enforcement
**Date**: 2026-03-05 (retroactive documentation: 2026-03-14)
**Status**: Complete — all decisions implemented and shipped

## R1: Authorization Decision Matrix Design

**Decision**: Pure-function authorization with exhaustive pattern matching on `(policyAvailable, outcome, riskLevel, externalTenant)`.

**Rationale**: A stateless pure function (`authorizeAction`) makes the decision matrix fully testable without mocking infrastructure. Every combination of inputs maps to exactly one `AuthorizationResult`. This avoids hidden state, race conditions, and makes the trust boundary auditable.

**Implementation**: `apps/desktop-companion/src/authorization.ts`
- Input: `AuthorizationInput { riskLevel, outcome, policyAvailable, externalTenant }`
- Output: `AuthorizationResult { allowed, needsApproval, reason }`
- 5 machine-readable reasons: `allowed`, `denied_by_policy`, `approval_required`, `degraded_low_risk`, `policy_unavailable_fail_closed`

**Alternatives considered**:
- **Rule engine / policy DSL**: Rejected — overkill for 4 input dimensions; pure function is simpler and fully type-checked
- **Server-side evaluation only**: Rejected — desktop must enforce locally when policy is unavailable (fail-closed requirement)
- **Cached policy with TTL**: Rejected for this feature — caching adds staleness risk. Fresh evaluation per action is preferred.

## R2: Runtime Routing Matrix

**Decision**: Binary routing (`local` vs `remote`) based on tenant class and admin configuration.

**Rationale**: External tenants must never execute locally — this is a hard security boundary. Internal tenants get local execution only when explicitly enabled by admin. The routing function is separate from authorization to maintain single-responsibility.

**Implementation**: `packages/session-agent/src/runtimeRouting.ts`
- `selectRuntimeTarget(tenantClass, localAllowedForTenant)` → `"local" | "remote"`
- External tenants: always `"remote"` regardless of config
- Internal tenants: `"local"` only when `localAllowedForTenant === true`

**Alternatives considered**:
- **Per-action routing (some actions local, some remote)**: Rejected — adds complexity without current need. Routing is per-tenant, not per-action.
- **Hybrid routing with fallback**: Rejected — "try local, fall back to remote" creates ambiguity about which path actually ran. Binary choice is safer.

## R3: Fail-Closed Outage Behavior

**Decision**: Risk-tier-based fail-closed with tenant-class differentiation.

**Rationale**: When the policy service is unavailable, the desktop must not silently allow high-risk actions. The fail-closed matrix ensures:
- External tenants: blocked on medium, high, and critical risk (only low risk proceeds in degraded mode)
- Internal tenants: blocked on high and critical risk (low and medium proceed in degraded mode)
- This asymmetry reflects the trust differential between internal and external tenants

**Implementation**: `packages/session-agent/src/runtimeRouting.ts`
- `shouldFailClosed(riskLevel, policyAvailable, tenantClass)` → `boolean`
- Also enforced in `authorizeAction()` which returns `policy_unavailable_fail_closed` reason

**Alternatives considered**:
- **Fail-open for all**: Rejected — violates security-first principle
- **Fail-closed for all**: Rejected — blocks internal low-risk work during outages, hurting productivity without proportional security gain
- **Cached decisions during outage**: Rejected — stale decisions could authorize actions the policy would now deny

## R4: RiskLevel Type Design

**Decision**: Union type `"low" | "medium" | "high" | "critical"` shared across packages.

**Rationale**: RiskLevel is defined in 4 places (policy-client, session-agent, authorization, controlPlaneContracts) because each package is independently typed. The "critical" level was added during feature 004 to support blocking handoffs during critical-risk pending actions.

**Implementation**: Identical `type RiskLevel` in:
- `packages/policy-client/src/policyClient.ts`
- `packages/session-agent/src/runtimeRouting.ts`
- `apps/desktop-companion/src/authorization.ts`

**Trade-off**: Duplicated type definition across packages. A shared types package was considered but rejected to keep packages independently consumable without circular dependencies.

## R5: Policy Token Validation

**Decision**: Structured token validation with context binding.

**Rationale**: Policy decision tokens must be verified to prevent replay attacks. The token contains `tenantId`, `workspaceId`, `actionHash`, and `expEpochSeconds`. Validation checks all fields match the current request context.

**Implementation**: `packages/policy-client/src/policyClient.ts`
- `DecisionToken` interface with JTI, tenant/workspace/action binding, and expiry
- `DecisionContext` for comparison
- Token claim mapping via `DecisionTokenClaimMap`

## Open Questions (from ANALYSIS-NOTES.md)

4 edge cases identified in post-completion analysis (MEDIUM severity):

1. Empty/malformed policy decision token — needs rejection test
2. Token mismatch (tenant/workspace/action hash) — needs rejection test
3. Late-arriving policy response after timeout — needs integration test
4. Routing disagreement (cached vs fresh tenant metadata) — needs integration test

**Recommendation**: Create WP05 to cover these 4 edge cases. Estimated effort: 1-2 hours.
