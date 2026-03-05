# Joyus Desktop Constitution

> Project principles for the `joyus-desktop` runtime repository.

---

## 1. Project Identity

**Name:** Joyus Desktop  
**Purpose:** Desktop companion runtime for Joyus AI that improves endpoint UX and operational safety while preserving open-core platform compatibility.

The desktop runtime is optional for platform viability. The platform core remains usable through public control-plane interfaces without the desktop app.

---

## 2. Core Principles

### 2.1 Open-Core Compatibility

- `joyus-ai` remains the public, self-hostable core for mediation, policy, and provenance.
- `joyus-desktop` may be private/commercial.
- Desktop clients must consume documented control-plane contracts and must not create lock-in.

### 2.2 No Desktop Lock-In

- Core mediation and policy capabilities must not depend on closed binaries.
- Any feature first introduced in desktop must have an equivalent control-plane contract.

### 2.3 Security-First Enforcement

- Privileged actions require policy decisions.
- External medium/high-risk actions fail closed on policy unavailability.
- Tenant/workspace/action binding is mandatory for decision validation.

### 2.4 Runtime Separation

- External tenants default to remote execution.
- Internal tenants may run local execution when explicitly enabled.

### 2.5 Full Coverage Gates

- 100% lines/functions/branches/statements coverage is mandatory.
- CI failure on coverage drop blocks merge.

### 2.6 Incremental Delivery

- Ship policy enforcement and routing first.
- Add endpoint convenience and packaging only after trust boundaries are stable.

---

## 3. Amendment Process

1. Document the principle change and rationale.
2. Update this file with version history.
3. Communicate changes to maintainers across `joyus-ai`, `joyus-desktop`, and `joyus-ai-ops`.

---

*Constitution Version: 1.0*  
*Established: March 5, 2026*  
*Last Updated: March 5, 2026*
