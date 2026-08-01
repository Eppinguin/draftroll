# Operations guide

This guide covers repository-provided deployment configuration, smoke tests, monitoring probes, and secure defaults. Supplying real Cloudflare account resources remains an environment-owner responsibility.

## Environment configuration

Copy `apps/worker/wrangler.deploy.example.jsonc` to the gitignored `apps/worker/wrangler.deploy.jsonc`. Replace:

- staging and production D1 database IDs
- application origins
- token issuer and audience
- production route/domain
- room-policy preset and limits appropriate to the deployment

The template explicitly disables anonymous access in staging and production. Do not put secrets in Wrangler JSON.

## Secrets

Use Wrangler secrets separately for each environment:

```bash
pnpm --filter @draftroll/worker exec wrangler secret put ROOM_TOKEN_KEYS --config wrangler.deploy.jsonc --env staging
pnpm --filter @draftroll/worker exec wrangler secret put ROOM_TOKEN_KEYS --config wrangler.deploy.jsonc --env production
```

`ROOM_TOKEN_KEYS` is a JSON key-ID to HMAC-secret map. Require issuer, audience, `iat`, and `jti`. Keep previous verification keys until all corresponding tokens expire or are revoked.

## Migrate and deploy

```bash
pnpm worker:migrate:staging
pnpm worker:deploy:staging
DRAFTROLL_BASE_URL=https://staging-dice.example.com DRAFTROLL_EXPECT_ENV=staging DRAFTROLL_EXPECT_ANONYMOUS=false pnpm worker:smoke:deployment

pnpm worker:migrate:production
pnpm worker:deploy:production
DRAFTROLL_BASE_URL=https://dice.example.com DRAFTROLL_EXPECT_ENV=production DRAFTROLL_EXPECT_ANONYMOUS=false pnpm worker:smoke:deployment
```

Deployment scripts intentionally require the untracked `wrangler.deploy.jsonc` and environment variables for smoke checks.

## Overlay hosting

Build with `pnpm build:overlay`. Prefer serving `dist-overlay/draftroll` from the consuming application's origin. For cross-origin hosting, set an exact `targetOrigin`, restrict `frame-ancestors`, configure the host `frame-src`, and run the Playwright cross-origin/CSP suite against production-built assets.

## Metrics and alerts

Collect client `getRequestMetrics()` snapshots and Worker structured logs. For manager-authorized room diagnostics, run:

```bash
DRAFTROLL_BASE_URL=https://dice.example.com \
DRAFTROLL_ROOM_ID=operations-room \
DRAFTROLL_ROOM_TOKEN=... \
node scripts/check-room-health.mjs
```

Recommended alerts:

- health endpoint failure or protocol mismatch
- p95 request latency above the deployment budget for 5 minutes
- request failure rate above 2% excluding user cancellation
- revision conflicts above an application-specific threshold
- replay truncation or long-range recovery spikes
- reconnect loops or abnormal close code 1006 spikes
- any Durable Object persistence failure
- hidden-projection count unexpectedly falling to zero in rooms that use hidden rolls
- retained events/rolls approaching policy limits

Use Cloudflare Workers observability/log destinations or the operator's existing telemetry stack. Never include tokens, passwords, complete hidden results, or signing secrets in logs.
