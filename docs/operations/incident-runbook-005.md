# Incident Runbook — Feature 005: Live Control Plane Integration

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Status**: Pilot-ready (complete sign-off required before launch)
**Owner**: joyus-ai-ops
**Last updated**: 2026-03-19

---

## Alert Definitions

### Alert 1: Policy Failure Rate (P1)

| Field | Value |
|-------|-------|
| **Signal** | Ratio of failed policy decisions (non-2xx HTTP or `ControlPlaneTimeoutError`) to total decisions |
| **Threshold** | >5% in any 5-minute rolling window |
| **Evaluation window** | 5 minutes |
| **Severity** | P1 — page on-call |

**Immediate response steps**:
1. Check control plane health endpoint (`GET ${JOYUS_API_URL}/health`).
2. If the control plane is down, the companion is already fail-closed — no immediate user action is blocked incorrectly, but enforcement gaps may appear for low-risk degraded-mode actions.
3. Review retry logs in companion stderr for `ControlPlaneTimeoutError` or `MCP request failed` messages.
4. Escalate to joyus-ai-ops if the outage persists beyond 5 minutes.

---

### Alert 2: Replay Attempt Detected (P0)

| Field | Value |
|-------|-------|
| **Signal** | Any `policy.replay` event received at `/events` endpoint |
| **Threshold** | ≥1 event in any evaluation period |
| **Evaluation window** | Immediate (event-driven) |
| **Severity** | P0 — immediate investigation required; potential security incident |

**Immediate response steps**:
1. Retrieve the event payload from the `/events` log: identify `jti` and `tenantId`.
2. Determine the source: was the companion restarted without DB persistence? Was the JTI stolen?
3. If theft is suspected: rotate `JOYUS_API_TOKEN` for the affected tenant immediately.
4. Search companion logs for prior use of the JTI to identify the original decision context.
5. File a security incident ticket within 30 minutes of detection.

---

### Alert 3: Policy Latency p95 > 2s (P2)

| Field | Value |
|-------|-------|
| **Signal** | 95th percentile round-trip latency for `POST /mcp` (policy decisions) |
| **Threshold** | >2 seconds in any 5-minute window |
| **Evaluation window** | 5 minutes |
| **Severity** | P2 — warn; no page unless sustained >10 minutes |

**Immediate response steps**:
1. Check network connectivity between companion host and `JOYUS_API_URL` (ping, traceroute).
2. Review `requestTimeoutMs` config — default is 5000ms; reduce to 2000ms if latency is consistently high and decisions need to fail faster.
3. Check retry logs for excessive backoff accumulation (`retryBaseDelayMs * 2^attempt`).
4. If latency is caused by a noisy-neighbor or underprovisioned control plane, escalate to joyus-ai-ops.

---

## Incident Runbook

### Scenario A: Control Plane Outage

**Goal**: Verify the companion blocks actions (fail-closed) during an outage, fires the P1 alert,
and automatically resumes enforcement after recovery — without a restart.

**Simulate**:
```bash
# On the staging control plane host — bring down the API
sudo systemctl stop joyus-ai-staging
# Or, to simulate at the network layer:
# sudo iptables -I OUTPUT -d <control-plane-ip> -j DROP
```

**Verify**:
1. Attempt a policy-gated action from the companion.
2. Confirm the action is blocked (not silently allowed).
3. Confirm `ControlPlaneTimeoutError` or `MCP request failed (503)` appears in companion logs.
4. Confirm the P1 "Policy Failure Rate" alert fires within the 5-minute evaluation window.

**Remediate**:
```bash
# Restore the staging API
sudo systemctl start joyus-ai-staging
# Or remove iptables rule:
# sudo iptables -D OUTPUT -d <control-plane-ip> -j DROP
```

**Verify recovery**:
1. Wait for one retry cycle (default: up to 3 attempts, backoff up to ~800ms total).
2. Attempt a policy-gated action again.
3. Confirm the action succeeds — **no companion restart required**.
4. Confirm the P1 alert resolves within the next evaluation window.

---

### Scenario B: Replay Attack Simulation

**Goal**: Verify that replaying a previously-consumed JTI is rejected, the P0 alert fires,
and the event is logged to `/v1/events`.

**Simulate**:
```bash
# Extract a JTI from recent companion logs:
JTI=$(grep 'policy.decision' ~/.joyus/event-failures.ndjson | head -1 | jq -r '.payload.jti')

# Use the test tooling to replay the JTI:
pnpm vitest run apps/desktop-companion/test/integration/pilot-acceptance.test.ts \
  --reporter=verbose -t "reused JTI"
```

Or write a one-off script that calls `openReplayCache({ dbPath: '~/.joyus/replay-cache.db' })`
and calls `cache.consume(token)` twice with the same JTI.

**Verify**:
1. Confirm the second `consume()` call returns `{ ok: false, originalConsumedAt: <timestamp> }`.
2. Confirm a `policy.replay` event is emitted to `/v1/events` (check event delivery logs or staging event sink).
3. Confirm the P0 "Replay Attempt Detected" alert fires immediately.

**Remediate**:
1. Identify whether the replay was caused by a companion restart (DB not persisted) or a genuine token theft.
2. If token theft: rotate `JOYUS_API_TOKEN` for the affected tenant.
3. If DB loss: ensure `JOYUS_REPLAY_CACHE_PATH` points to a persistent volume, not a tmpfs.

**Verify recovery**:
1. Confirm subsequent first-use JTIs are accepted normally.
2. Confirm no new replay alerts fire for 10 minutes.

---

### Scenario C: High Latency

**Goal**: Verify the p95 latency alert fires at the 2-second threshold.

**Simulate**:
```bash
# Introduce artificial delay using tc (traffic control) on the companion host:
sudo tc qdisc add dev eth0 root netem delay 2500ms
# Or use a stub proxy (toxiproxy) between companion and control plane
```

**Verify**:
1. Make 20+ policy decision requests through the companion.
2. Confirm p95 latency exceeds 2 seconds in the monitoring dashboard.
3. Confirm the P2 "Policy Latency" alert fires.

**Remediate**:
```bash
# Remove the artificial delay
sudo tc qdisc del dev eth0 root netem
```

**Verify recovery**:
1. Make 20+ policy decision requests.
2. Confirm p95 latency returns below 2 seconds.
3. Confirm the P2 alert resolves.

---

## Pre-Pilot Checklist

Complete this checklist before launching the pilot. All items must pass.

### Environment Configuration
- [ ] `JOYUS_API_URL` set in companion config and points to the correct staging/prod endpoint
- [ ] `JOYUS_API_TOKEN` present and valid (test with `curl -H "Authorization: Bearer $JOYUS_API_TOKEN" $JOYUS_API_URL/health`)
- [ ] mTLS cert paths configured (set `JOYUS_MTLS_CERT_PATH`, `JOYUS_MTLS_KEY_PATH`, `JOYUS_MTLS_CA_PATH` if required by ops team)
- [ ] `JOYUS_REPLAY_CACHE_PATH` set to a persistent path (not tmpfs); directory is writable by companion process
- [ ] `JOYUS_REQUEST_TIMEOUT_MS` reviewed — default 5000ms is appropriate for most deployments

### Technical Validation
- [ ] `pnpm ci` passes on main branch (typecheck + 100% coverage)
- [ ] Acceptance tests pass: `pnpm vitest run apps/desktop-companion/test/integration/pilot-acceptance.test.ts`
- [ ] Replay cache DB initializes without error at startup

### Operational Validation
- [ ] All three runbook scenarios (A, B, C) walked through manually on staging
- [ ] Alert definitions deployed to monitoring system and verified to fire on staging
- [ ] On-call rotation aware of new P0 replay alert (added to escalation policy)
- [ ] Incident runbook reviewed by at least 2 engineers (names below)

---

## Sign-Off

Complete this section before pilot launch. All items must be checked.

### Technical Validation
- [ ] `pnpm ci` passes on main branch
- [ ] Acceptance tests pass (`pnpm vitest run pilot-acceptance.test.ts`)
- [ ] All three runbook scenarios walked through manually on staging

### Operational Validation
- [ ] Alert definitions deployed and verified to fire
- [ ] On-call rotation aware of new P0 replay alert
- [ ] Incident runbook reviewed by at least 2 engineers

### Pilot Authorization

| Field | Value |
|-------|-------|
| Validated by | ___________ |
| Date | ___________ |
| Staging run URL (if applicable) | ___________ |
| Notes | ___________ |

**Reviewer 1**: ___________
**Reviewer 2**: ___________
