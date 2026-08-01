# Self-hosted deployment

Draftroll's realtime service is an optional Cloudflare Worker with one Durable Object per room and D1 persistence. The repository includes secure staging/production templates, migrations, smoke probes, monitoring thresholds, incident response, and rollback procedures. Real account IDs, routes, origins, and secrets must be supplied by the deployment owner.

## 1. Verify locally

```bash
pnpm install
pnpm test:core
pnpm worker:test:local
pnpm build:overlay
```

The Vite playground is a test client, not a production artifact.

## 2. Create the deployment configuration

```bash
cp apps/worker/wrangler.deploy.example.jsonc apps/worker/wrangler.deploy.jsonc
```

The destination is gitignored. Replace both D1 placeholders, allowed origins, issuer/audience, and production route. The template has explicit `staging` and `production` environments and sets `ALLOW_ANONYMOUS=false` in both.

Create the D1 databases with Wrangler, place their IDs in the untracked configuration, and retain separate databases for staging and production.

## 3. Configure secrets and key rotation

Store secrets with Wrangler rather than JSON configuration:

```bash
pnpm --filter @draftroll/worker exec wrangler secret put ROOM_TOKEN_KEYS --config wrangler.deploy.jsonc --env staging
pnpm --filter @draftroll/worker exec wrangler secret put ROOM_TOKEN_KEYS --config wrangler.deploy.jsonc --env production
```

`ROOM_TOKEN_KEYS` is a JSON object mapping key IDs to high-entropy HMAC secrets. The environment template requires token IDs and configures issuer/audience checks. Rotate by adding a new verification key, issuing new tokens with its key ID, retaining prior verification keys until expiry/revocation coverage is complete, then removing the old key. Never restore a compromised key during rollback.

## 4. Migrate, deploy, and smoke-test

```bash
pnpm worker:migrate:staging
pnpm worker:deploy:staging
DRAFTROLL_BASE_URL=https://staging-dice.example.com \
DRAFTROLL_EXPECT_ENV=staging \
DRAFTROLL_EXPECT_ANONYMOUS=false \
pnpm worker:smoke:deployment

pnpm worker:migrate:production
pnpm worker:deploy:production
DRAFTROLL_BASE_URL=https://dice.example.com \
DRAFTROLL_EXPECT_ENV=production \
DRAFTROLL_EXPECT_ANONYMOUS=false \
pnpm worker:smoke:deployment
```

For an authorized room-state smoke check, additionally provide `DRAFTROLL_SMOKE_ROOM_ID`, `DRAFTROLL_SMOKE_TOKEN`, and optionally `DRAFTROLL_SMOKE_ORIGIN`/`DRAFTROLL_SMOKE_ROOM_PASSWORD`.

## 5. Host the overlay

Build with `pnpm build:overlay` and serve `dist-overlay/draftroll` from the consuming application's origin when possible. Cross-origin hosting requires an exact SDK `targetOrigin`, an allowed `frame-src`, an overlay `frame-ancestors` policy, and the Worker origin in `connect-src`. The Playwright suite includes cross-origin and CSP fixtures.

## 6. Monitor and roll back

Run `pnpm worker:health` from a scheduler and deployment pipeline. See:

- `docs/OPERATIONS.md`
- `docs/MONITORING.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/ROLLBACK.md`
- `docs/TOKEN_SECURITY.md`
- `docs/ENTROPY_POLICY.md`

D1 migrations are additive. Roll back Worker code without destructively reversing schema migrations.

## Runtime enforcement

Room endpoints require protocol version 2. The Worker strictly decodes commands/events, enforces message and metadata limits, projects hidden data per participant, supports passwords and room-scoped signed capabilities, persists replay/idempotency records, and exposes manager-only diagnostics. Per-room/IP limits are implemented inside each Durable Object; deployments needing one shared budget across many rooms should add an edge-level Cloudflare Rate Limiting rule or binding.

## Out of scope

The repository intentionally does not include npm publishing, registry credentials, billing, account management, real Cloudflare resource IDs, or production secrets.
