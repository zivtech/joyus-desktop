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

- [ ] Ensure allow/deny/escalate behavior is explicit and deterministic.
- [ ] Ensure approval-required path is enforced for escalate outcomes.
- [ ] Add exhaustive unit tests for all decision branches.

### WP02 — Runtime Routing Enforcement
**Prompt**: [`tasks/WP02-runtime-routing.md`](tasks/WP02-runtime-routing.md)  
**Dependencies**: none

- [ ] Enforce external tenant remote-only execution.
- [ ] Enforce internal local/remote selection based on policy.
- [ ] Add exhaustive routing tests.

### WP03 — Fail-Closed Outage Policy
**Prompt**: [`tasks/WP03-fail-closed-outage.md`](tasks/WP03-fail-closed-outage.md)  
**Dependencies**: none

- [ ] Enforce fail-closed for external medium/high when policy is unavailable.
- [ ] Enforce fail-closed for internal high when policy is unavailable.
- [ ] Add outage matrix tests.

### WP04 — Verification & CI Gate Compliance
**Prompt**: [`tasks/WP04-verification-ci.md`](tasks/WP04-verification-ci.md)  
**Dependencies**: WP01, WP02, WP03

- [ ] Run full typecheck and coverage gates.
- [ ] Confirm 100% coverage across desktop runtime modules.
- [ ] Record completion in task history and move WPs to done.
