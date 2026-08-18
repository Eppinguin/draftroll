# Draftroll local development

This setup runs the optional Draftroll realtime backend locally with Wrangler, a local Durable Object namespace, and a local D1 database. It does not require a Cloudflare account and does not touch production data.

## Requirements

- Node.js 22.13 or newer
- Corepack, or another pnpm installation
- pnpm 11.17.0, pinned by the root `packageManager` field

Enable the pinned pnpm version:

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

Install from the repository root:

```bash
pnpm install
```

All unpublished internal packages use `workspace:*`, so pnpm links them locally. Do not run `pnpm install` inside an individual `packages/*` directory; doing so removes the workspace context and can cause registry lookups.

The first successful install creates `pnpm-lock.yaml`. Commit that file once dependencies resolve on your machine.

## Run the required quality gates

Run these commands from the repository root:

```bash
pnpm lint
pnpm fmt:check
pnpm check
```

Use `pnpm lint:fix` for safe Oxlint fixes and `pnpm fmt` to apply Oxfmt. `pnpm check` also runs TSDoc validation and all TypeScript checks. See `docs/CODE_QUALITY.md` for the complete policy.

## Test completed-roll revisions without Wrangler

Run the deterministic SDK/core revision test:

```bash
pnpm test:updates
```

It verifies:

1. A completed roll receives a stable local roll ID and revision `0`.
2. A log-only die correction updates the result panel hook without replaying the physical dice.
3. Formula replacement can preserve existing compatible values.
4. Selected or all dice can be rerolled during a revision.
5. Changed-die animation sends only the selected physical dice to the renderer.
6. The current log keeps one entry per roll ID.
7. Immutable snapshots remain available for every revision.

## Fastest backend verification

Run the complete local backend test in one command:

```bash
pnpm worker:test:local
```

This command:

1. Applies all local D1 migrations, including current-roll and revision-history tables.
2. Starts `wrangler dev` on `127.0.0.1:8787`.
3. Checks `/health`.
4. Opens a room WebSocket.
5. Tests clock synchronization.
6. Requests a server-authoritative `2d20kh1+5` roll.
7. Sends a portable weighted/symbolic custom-die pool and rerolls it through the room server.
8. Sends an exact external result.
9. Applies a log-only correction to the completed roll.
10. Applies an animated revision and waits for its synchronized start event.
11. Verifies Durable Object room state contains the latest revision.
12. Verifies D1 contains current rows and immutable revision snapshots.
13. Stops Wrangler.

A successful run prints a JSON summary containing the room ID, roll IDs, totals, sequence, latest revision, current history count, and revision audit count.

## Run Wrangler interactively

Prepare the local D1 schema:

```bash
pnpm worker:setup
```

Start the Worker:

```bash
pnpm worker:dev
```

Wrangler serves the backend at:

```text
http://127.0.0.1:8787
```

Useful endpoints:

```text
GET  /health
GET  /rooms/:roomId/state
GET  /rooms/:roomId/history?limit=20
GET  /rooms/:roomId/rolls/:rollId/revisions
WS   /rooms/:roomId/connect
```

Run the smoke test from another terminal while Wrangler remains open:

```bash
pnpm worker:smoke
```

Set a different server address with:

```bash
DRAFTROLL_BASE_URL=http://127.0.0.1:8790 pnpm worker:smoke
```

## Test synchronized rolls in the character-sheet client

Run Wrangler and the Vite test client together:

```bash
pnpm dev:stack
```

Open `http://127.0.0.1:5173`. The client is a minimal character sheet rather than a renderer-only playground. It includes:

- character, class, and level fields
- formula presets for checks, attacks, damage, and mixed dice
- free-form d20-compatible formula input
- character and action/roll names
- anonymous room connection controls
- server-authoritative synchronized rolling
- a persisted room dice log
- whole-roll and individual-die rerolls
- formula/name/theme revisions with animated or log-only updates

The built-in mixed examples include `1d20+7+1d4`, `2d6+1d8+3`, and the universal fallback test `1d20+1d2+1dF+1d9+1d100`. Supported d2/d4/d6/d8/d10/d12/d20 dice share one physical simulation; unsupported shapes join that same presentation as synchronized coin, percentile, Fate, spinner, token, or card visuals.

See `docs/CHARACTER_SHEET_TEST_CLIENT.md` for the complete workflow and protocol fields. The character sheet remains a development host and is not part of the Worker service.

## Test website overlay and completed-roll editing

Run the dedicated host-page example:

```bash
pnpm dev:embed
```

Open the URL printed by Vite if the browser does not open automatically. The example is an ordinary host page with Draftroll mounted transparently above it. It demonstrates:

- host controls remaining clickable beneath the dice layer
- the built-in result display
- different themes per die
- individual-die reroll buttons
- correcting a completed die without replaying the 3D layer
- replacing the completed roll formula and rolling the revision again
- preserving one logical roll entry while its revision number increases
- programmatic overlay clearing

Build only the production overlay renderer, without the playground:

```bash
pnpm build:overlay
```

The output is `dist-overlay/draftroll`.

## Local data and reset

Wrangler stores local D1 and Durable Object state below:

```text
apps/worker/.wrangler/state
```

Reset all local backend state and reapply migrations:

```bash
pnpm worker:reset
```

Inspect current roll rows directly:

```bash
pnpm --filter @draftroll/worker exec wrangler d1 execute DB \
  --local \
  --config wrangler.jsonc \
  --command "SELECT roll_id, room_id, sequence, revision, authority, total, created_at, updated_at FROM roll_history ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 20"
```

Inspect immutable revision snapshots:

```bash
pnpm --filter @draftroll/worker exec wrangler d1 execute DB \
  --local \
  --config wrangler.jsonc \
  --command "SELECT roll_id, room_id, sequence, revision, recorded_at FROM roll_revisions ORDER BY recorded_at DESC, revision DESC LIMIT 50"
```

Apply migrations manually after adding a numbered SQL file under `apps/worker/migrations`:

```bash
pnpm worker:setup
```

## Wrangler configuration

The backend configuration is `apps/worker/wrangler.jsonc`.

It declares:

- the `draftroll-room` Worker
- a `DICE_ROOMS` Durable Object binding
- the SQLite-backed `DiceRoomObject` class through Wrangler's declarative `exports` field
- a local `DB` D1 binding
- local browser origins for the Vite playground
- Worker observability

The D1 binding intentionally has no production database ID. Local Wrangler creates isolated local resources. No public package publishing or registry release setup is required for this workflow.

## Common problems

### `pnpm` is not available

Run:

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

If Corepack is not installed with your Node distribution, install Corepack first and repeat those commands.

### Port 8787 is occupied

Stop the conflicting process, or run Wrangler directly with another port:

```bash
pnpm --filter @draftroll/worker exec wrangler dev \
  --config wrangler.jsonc \
  --local \
  --ip 127.0.0.1 \
  --port 8790
```

Then point the smoke test or browser client at port `8790`.

### D1 reports a missing table or column

Apply every migration:

```bash
pnpm worker:setup
```

For a clean reset:

```bash
pnpm worker:reset
```

### Browser room connection fails

Confirm that:

- `pnpm worker:dev` is running
- the room server field uses `http://127.0.0.1:8787`
- the Vite client is running at an origin listed in `ALLOWED_ORIGINS`
- no proxy or browser extension is blocking local WebSockets

## Testing participant permissions and hidden rolls

Local Wrangler uses unsigned anonymous participants:

```jsonc
"vars": {
  "ALLOW_ANONYMOUS": "true",
  "EVENT_BUFFER_LIMIT": "200"
}
```

Run the complete two-participant smoke test:

```bash
pnpm worker:test:local
```

The smoke test verifies:

- participant/session initialization
- request and client-roll correlation
- public mixed-dice broadcasts
- roller-only hidden results
- result projection without totals, dice, or animation seeds
- ownership enforcement
- revision conflicts
- reveal through `roll_visibility_updated`
- reconnect recovery from `eventSequence`
- permission-filtered D1 history and revision snapshots

The fourth D1 migration adds actor and visibility data to current history rows and immutable revisions:

```text
apps/worker/migrations/0004_room_permissions.sql
```

After pulling the change, apply migrations:

```bash
pnpm worker:setup
```

For secure local testing, set `ALLOW_ANONYMOUS` to `false` and configure verification keys. `ROOM_TOKEN_KEYS` is a JSON object mapping key IDs to secrets; `ROOM_TOKEN_SECRET` is retained only for legacy no-key-ID tokens. Also configure `ROOM_TOKEN_ISSUER`, `ROOM_TOKEN_AUDIENCE`, and `ROOM_TOKEN_REQUIRE_JTI=true` when testing production-style claims and revocation.

Generate tokens from trusted server-side code with `@draftroll/server`. Signing keys must not be placed in the browser or Vite environment. See `TOKEN_SECURITY.md` for example values, rotation, and revocation.

### Playground becomes a black full-screen surface

The SDK overlay must remain transparent and visually inactive until a roll begins. The current build enforces this in three places: an inline transparent baseline in `overlay.html`, overlay-only CSS that removes the legacy playground surface, and an iframe lifecycle that is hidden while idle. If an older checkout still shows black, clear Vite's cache and restart:

```bash
rm -rf node_modules/.vite
pnpm dev:stack
```

Also hard-refresh the browser so it does not reuse an older overlay module.

## Wrangler compatibility date

The checked-in `wrangler.jsonc` uses `compatibility_date: "2026-07-29"`. Keep this date until the installed Wrangler release accepts a later compatibility date.

## Protocol-version query parameter

Room HTTP and WebSocket endpoints require `protocolVersion=2`. The SDK adds this automatically. For direct manual requests, include it explicitly:

```text
http://127.0.0.1:8787/rooms/local-table/state?protocolVersion=2
ws://127.0.0.1:8787/rooms/local-table/connect?protocolVersion=2&participantId=dev&sessionId=dev-1&name=Developer
```

Unsupported or missing versions return HTTP `426` with `supportedProtocolVersions`.

The workspace explicitly allows the reviewed install builds used by Vite and Wrangler in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
  workerd: true
```

## Test room policies and hardening

The local Worker starts new rooms from `ROOM_POLICY_PRESET=open-table`. Policy updates require a participant with `room:manage`; unsigned local participants intentionally do not receive that capability. Use a signed local capability token when testing manager operations.

Run the deterministic hardening suite directly:

```bash
node scripts/test-room-hardening.mjs
```

The suite checks policy presets and patches, runtime schema decoding, policy command/event/state shapes, Worker enforcement hooks, the Wrangler compatibility date, the pnpm `esbuild` and `workerd` build approvals, and that package versions remain unchanged.

Useful policy behavior to test with two clients:

1. Fill a room to `maximumParticipants` and verify the next upgrade is rejected.
2. Disable whispers and verify targeted visibility is rejected before evaluation.
3. Exceed session, participant, or room roll limits and inspect `retryAfterMs`.
4. Change a policy with a stale `expectedRevision` and verify a conflict response.
5. Disable the room and verify non-manager mutations stop while a manager can re-enable it.
6. Lower stale-session and idle-expiry values in a disposable room and observe alarm cleanup.

No remote migration, deployment, package-version change, or protocol-version change is needed for this local milestone.

## Browser integration tests

Browser-level WebGL, iframe, CSP, WebSocket, reconnect, and multi-participant behavior is covered by Playwright.

```bash
pnpm test:browser:install
pnpm test:browser:chromium
```

Use the complete cross-browser and mobile matrix with:

```bash
pnpm test:browser
```

The suite resets only local Wrangler/D1 state and starts dedicated fixture origins on ports 4173 and 4174. It does not deploy anything. See `docs/BROWSER_TESTING.md` for the CSP presets, server topology, and CI guidance.

## Renderer performance validation

```bash
pnpm test:performance
pnpm test:browser:performance
```

`pnpm-workspace.yaml` permits install scripts for both `esbuild` and `workerd`. No other dependency build scripts are approved by the project workspace.
