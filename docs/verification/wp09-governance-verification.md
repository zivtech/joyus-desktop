# WP09 Governance Verification (T051)

## Objective
Verify that tool blocking works correctly in enforce mode.

## Test Scenarios

### 1. Enforce Mode - Policy Deny Blocks Tool
- **Setup**: Configure governance mode to "enforce", policy returns "deny"
- **Action**: Invoke MCP tool through middleware
- **Expected**: Tool is NOT executed, result has `proceed: false`, telemetry emitted with outcome "blocked"
- **Status**: PASS - Covered in `mcpMiddleware.test.ts` and `governanceEnforcer.test.ts`

### 2. Enforce Mode - Policy Error Blocks Tool (Fail-Closed)
- **Setup**: Configure governance mode to "enforce", policy throws error
- **Action**: Invoke MCP tool through middleware
- **Expected**: Tool is NOT executed, result has `proceed: false, decision: "deny"`, error logged
- **Status**: PASS - Covered in `governanceEnforcer.test.ts` (fail-closed) and `mcpMiddleware.test.ts`

### 3. Enforce Mode - Policy Allow Permits Tool
- **Setup**: Configure governance mode to "enforce", policy returns "allow"
- **Action**: Invoke MCP tool through middleware
- **Expected**: Tool IS executed, result has `proceed: true`, telemetry emitted with outcome "success"
- **Status**: PASS - Covered in `mcpMiddleware.test.ts` and `governanceEnforcer.test.ts`

### 4. Audit Mode - Policy Deny Still Permits Tool
- **Setup**: Configure governance mode to "audit", policy returns "deny"
- **Action**: Invoke MCP tool through middleware
- **Expected**: Tool IS executed, decision logged, result has `proceed: true, audited: true`
- **Status**: PASS - Covered in `governanceEnforcer.test.ts` and `mcpMiddleware.test.ts`

### 5. Off Mode - No Policy Check
- **Setup**: Configure governance mode to "off"
- **Action**: Invoke MCP tool through middleware
- **Expected**: Tool IS executed, checkPolicy NOT called, result has `proceed: true, audited: false`
- **Status**: PASS - Covered in `governanceEnforcer.test.ts`

## Coverage
All governance enforcement paths are covered at 100% line/branch/function/statement coverage.
