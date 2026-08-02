# Monitoring and alerting

Draftroll exposes three operational telemetry layers without exporting hidden result contents:

1. `GET /health` for service/protocol/environment availability.
2. Manager-authorized `GET /rooms/:roomId/diagnostics?protocolVersion=2` for bounded room counters and persistence status.
3. Structured Worker logs plus client `DiceRoom.getRequestMetrics()` snapshots for latency, failures, conflicts, reconnects, replay recovery, and hidden projections.

## Probe command

```bash
DRAFTROLL_BASE_URL=https://dice.example.com \
DRAFTROLL_EXPECT_ENV=production \
DRAFTROLL_ROOM_ID=operations-room \
DRAFTROLL_ROOM_TOKEN="$ROOM_MANAGER_TOKEN" \
DRAFTROLL_MAX_PERSISTENCE_FAILURES=0 \
DRAFTROLL_MAX_BUFFERED_EVENTS=900 \
DRAFTROLL_MIN_RENDERER_READY_RATIO=0.8 \
pnpm worker:health
```

The command exits nonzero on an HTTP, protocol, environment, persistence, buffer, or readiness threshold violation. Run it from the deployment pipeline and from the operator's scheduler.

## Dashboard panels

Recommended panels, grouped by environment and room-policy preset:

- health success rate and protocol version
- authoritative request latency p50/p95/p99
- request failures by stable error code
- revision-conflict rate
- reconnect attempts and abnormal close codes
- replay truncations, recovered events, and long-range recovery count
- hidden projections observed by clients
- Durable Object active/authorized/renderer-ready sessions
- buffered/retained events and rolls versus policy limits
- D1 retry and persistence-failure log counts
- Worker CPU time, invocation failures, WebSocket duration, and D1 errors from Cloudflare observability

## Default alerts

| Alert                     |                         Initial threshold | Action                                                                     |
| ------------------------- | ----------------------------------------: | -------------------------------------------------------------------------- |
| Health/protocol failure   |                      2 consecutive probes | Block promotion; inspect Worker deployment/configuration                   |
| Persistence failure       |                            Any occurrence | SEV-2 unless known transient and fully recovered                           |
| Request failure rate      | >2% for 5 minutes, excluding cancellation | Inspect stable error-code distribution                                     |
| p95 authoritative latency |        Above deployment SLO for 5 minutes | Inspect Worker/D1/region and payload sizes                                 |
| Abnormal close 1006       |         3× normal baseline for 10 minutes | Inspect network/proxy/TLS and deployment health                            |
| Replay truncation         |                     Above normal baseline | Increase durable recovery investigation; do not only enlarge memory buffer |
| Renderer-ready ratio      |                    Below policy threshold | Inspect theme/renderer load failures and client versions                   |
| Retained event buffer     |                  >90% of configured limit | Inspect event rate and recovery policy                                     |

Tune thresholds after collecting controlled staging baselines. Do not alert on raw counts without normalizing for traffic.

## Privacy rules

Never log or label telemetry with bearer tokens, room passwords, signing keys, complete hidden results, formulas from hidden rolls, or arbitrary application metadata. Use room IDs, request IDs, stable error codes, projection counts, and aggregate timings. See `docs/INCIDENT_RESPONSE.md` and `docs/REALTIME_PERMISSIONS.md`.
