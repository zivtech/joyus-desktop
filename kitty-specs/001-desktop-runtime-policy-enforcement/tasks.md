# Work Packages: Desktop Runtime Policy Enforcement

**Total**: 4 work packages

## Dependency Graph

```
Layer 0: WP01 (authorization matrix), WP02 (runtime routing), WP03 (outage/fail-closed)
Layer 1: WP04 (integration + verification)
```

## Work Packages

### WP01 — Authorization Matrix Hardening
**Prompt**: [`tasks/WP01-authorization-matrix.md`](tasks/WP01-authorization-matrix.md)  
**Dependencies**: none

- [x] Ensure allow/deny/escalate behavior is explicit and deterministic.
- [x] Ensure approval-required path is enforced for escalate outcomes.
- [x] Add exhaustive unit tests for all decision branches.

### WP02 — Runtime Routing Enforcement
**Prompt**: [`tasks/WP02-runtime-routing.md`](tasks/WP02-runtime-routing.md)  
**Dependencies**: none

- [x] Enforce external tenant remote-only execution.
- [x] Enforce internal local/remote selection based on policy.
- [x] Add exhaustive routing tests.

### WP03 — Fail-Closed Outage Policy
**Prompt**: [`tasks/WP03-fail-closed-outage.md`](tasks/WP03-fail-closed-outage.md)  
**Dependencies**: none

- [x] Enforce fail-closed for external medium/high when policy is unavailable.
- [x] Enforce fail-closed for internal high when policy is unavailable.
- [x] Add outage matrix tests.

### WP04 — Verification & CI Gate Compliance
**Prompt**: [`tasks/WP04-verification-ci.md`](tasks/WP04-verification-ci.md)  
**Dependencies**: WP01, WP02, WP03

- [x] Run full typecheck and coverage gates.
- [x] Confirm 100% coverage across desktop runtime modules.
- [x] Record completion in task history and move WPs to done.

---

## Known Edge Case Gaps (Post-Completion)

*Identified during cross-artifact analysis (2026-03-10). These spec edge cases (spec.md §Edge Cases) should be verified in existing test suites or added as regression tests.*

1. **Empty/malformed policy decision token**: Verify authorization rejects with machine-readable reason.
2. **Token mismatch (tenant/workspace/action hash)**: Verify authorization rejects tokens that don't match the current context.
3. **Late-arriving policy response after timeout**: Verify deterministic behavior when policy response arrives after action timeout.
4. **Routing disagreement (cached vs fresh tenant metadata)**: Verify behavior when cached tenant class disagrees with freshly fetched metadata.

<!-- status-model:start -->
## Canonical Status (Generated)
- WP01: done
- WP02: done
- WP03: done
- WP04: done
<!-- status-model:end -->
