# Deployment rollback

Rollback is an application/Worker deployment operation; it must not roll D1 schema backward destructively.

## Worker code rollback

1. Identify the last known-good Cloudflare deployment/version.
2. Roll back Worker code using Cloudflare deployment version controls or redeploy the known-good commit with the same environment configuration.
3. Keep current D1 migrations applied. Repository migrations are additive; older code must ignore newer tables.
4. Run `scripts/smoke-deployment.mjs` against `/`, `/health`, and an authorized room state.
5. Verify WebSocket connection, roll creation, hidden projection, revision update, and reconnect recovery.

## Overlay/application rollback

Deploy immutable, versioned overlay assets. Change the consuming application's asset reference back to the prior version. Do not overwrite cached assets in place. Verify CSP and exact `targetOrigin` after rollback.

## Configuration rollback

Treat origin, token-key, issuer/audience, and anonymous-access changes separately from code. Never restore a compromised signing secret. Roll back by issuing with a safe key and retaining only necessary verification keys.

## Database changes

Do not drop tables or columns during an emergency rollback. Correct data through forward migrations. Back up/export D1 before any manual repair and test repair SQL against staging first.
