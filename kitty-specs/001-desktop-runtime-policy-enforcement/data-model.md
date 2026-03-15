# Data Model: Desktop Runtime Policy Enforcement

**Feature**: 001-desktop-runtime-policy-enforcement
**Date**: 2026-03-05 (retroactive documentation: 2026-03-14)

## Entities

### AuthorizationInput

The input to the authorization decision function. Represents the context of an action being evaluated.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| riskLevel | `"low" \| "medium" \| "high" \| "critical"` | Yes | Risk classification of the action |
| outcome | `"allow" \| "deny" \| "escalate"` | Yes | Policy decision outcome (from control plane) |
| policyAvailable | `boolean` | Yes | Whether the policy service responded |
| externalTenant | `boolean` | Yes | Whether the requesting tenant is external |

### AuthorizationResult

The output of the authorization decision. Consumed by runtime orchestration to proceed or block.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| allowed | `boolean` | Yes | Whether the action may proceed |
| needsApproval | `boolean` | Yes | Whether human approval is required before proceeding |
| reason | `ReasonCode` | Yes | Machine-readable reason for the decision |

**ReasonCode values**:
- `"allowed"` — policy returned allow, action proceeds
- `"denied_by_policy"` — policy returned deny
- `"approval_required"` — policy returned escalate, needs human approval
- `"degraded_low_risk"` — policy unavailable but risk is low enough to proceed
- `"policy_unavailable_fail_closed"` — policy unavailable and risk is too high

### DecisionToken

A signed token from the control plane that binds a policy decision to a specific request context.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| jti | `string` | Yes | Unique token identifier (JWT ID) |
| tenantId | `string` | Yes | Tenant the decision was made for |
| workspaceId | `string` | Yes | Workspace the decision was made for |
| actionHash | `string` | Yes | Hash of the action being authorized |
| expEpochSeconds | `number` | Yes | Token expiry (Unix epoch seconds) |

### DecisionContext

The current request context used to validate a DecisionToken.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tenantId | `string` | Yes | Current tenant ID |
| workspaceId | `string` | Yes | Current workspace ID |
| actionHash | `string` | Yes | Hash of the current action |

### RuntimeTarget

The execution destination for an action, determined by tenant class and admin config.

| Field | Type | Description |
|-------|------|-------------|
| target | `"local" \| "remote"` | Where the action executes |

## Decision Matrices

### Authorization Matrix

| Policy Available | Outcome | External Tenant | Risk Level | → Result |
|:---:|:---:|:---:|:---:|:---:|
| Yes | allow | * | * | allowed |
| Yes | deny | * | * | denied_by_policy |
| Yes | escalate | * | * | approval_required |
| No | * | Yes | low | degraded_low_risk |
| No | * | Yes | medium/high/critical | policy_unavailable_fail_closed |
| No | * | No | low/medium | degraded_low_risk |
| No | * | No | high/critical | policy_unavailable_fail_closed |

### Runtime Routing Matrix

| Tenant Class | Local Allowed | → Target |
|:---:|:---:|:---:|
| external | * | remote |
| internal | true | local |
| internal | false | remote |

### Fail-Closed Matrix

| Tenant Class | Risk Level | Policy Available | → Fail Closed? |
|:---:|:---:|:---:|:---:|
| external | low | No | No |
| external | medium+ | No | Yes |
| internal | low/medium | No | No |
| internal | high/critical | No | Yes |
| * | * | Yes | No |

## Relationships

```
AuthorizationInput ──uses──→ RiskLevel (shared type)
AuthorizationInput ──uses──→ Outcome (shared type)
authorizeAction(input) ──produces──→ AuthorizationResult

DecisionToken ──validated-against──→ DecisionContext
DecisionToken ──consumed-by──→ policyClient.verifyToken()

selectRuntimeTarget(tenantClass, localAllowed) ──produces──→ RuntimeTarget
shouldFailClosed(riskLevel, policyAvailable, tenantClass) ──produces──→ boolean
```

## Source Files

| Entity | Package | File |
|--------|---------|------|
| AuthorizationInput, AuthorizationResult | desktop-companion | `apps/desktop-companion/src/authorization.ts` |
| DecisionToken, DecisionContext | policy-client | `packages/policy-client/src/policyClient.ts` |
| RiskLevel (canonical) | policy-client | `packages/policy-client/src/policyClient.ts` |
| RuntimeTarget, TenantClass | session-agent | `packages/session-agent/src/runtimeRouting.ts` |
| shouldFailClosed | session-agent | `packages/session-agent/src/runtimeRouting.ts` |
