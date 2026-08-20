import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const worker = readFileSync(join(root, 'apps/worker/src/index.ts'), 'utf8');
const runtime = readFileSync(join(root, 'packages/protocol/src/runtime.ts'), 'utf8');
const deploy = readFileSync(join(root, 'apps/worker/wrangler.deploy.example.jsonc'), 'utf8');
const migrationEvents = readFileSync(
  join(root, 'apps/worker/migrations/0005_room_events.sql'),
  'utf8',
);
const migrationRequests = readFileSync(
  join(root, 'apps/worker/migrations/0006_room_requests.sql'),
  'utf8',
);

for (const marker of [
  "this.state.getWebSockets('draftroll-room')",
  'deserializeAttachment(socket)',
  'serializeAttachment',
  'private getSessions()',
])
  assert.ok(worker.includes(marker), `Durable Object hibernation recovery is missing ${marker}`);

const bulkStart = worker.indexOf('private async handleBulkRollUpdate');
const bulkEnd = worker.indexOf('private async handleVisibilityUpdate', bulkStart);
assert.ok(bulkStart >= 0 && bulkEnd > bulkStart, 'bulk update handler is missing');
const bulk = worker.slice(bulkStart, bulkEnd);
for (const marker of [
  'Validate and evaluate every mutation before committing any state',
  'assertRevision(previous.result, item.expectedRevision, item.rollId)',
  'await this.state.storage.put(storageEntries)',
  'for (const internal of internalEvents) this.broadcastRoll(internal)',
  'this.persistEventSafely(acknowledgement, policy)',
])
  assert.ok(bulk.includes(marker), `bulk update atomicity/idempotency is missing ${marker}`);
assert.ok(
  bulk.indexOf('await this.state.storage.put(storageEntries)') <
    bulk.indexOf('for (const internal of internalEvents) this.broadcastRoll(internal)'),
  'bulk update broadcasts before the atomic Durable Object commit',
);

for (const marker of [
  'private async withD1Retry',
  'const delays = [0, 25, 100, 250]',
  "this.logStructured('persistence.retry'",
  'private async recordPersistenceFailure',
  "this.logStructured('persistence.failed'",
  "this.state.storage.get<PersistenceFailure[]>('persistenceFailures')",
])
  assert.ok(worker.includes(marker), `D1 retry/failure diagnostics are missing ${marker}`);

for (const marker of [
  'INSERT INTO room_events',
  'INSERT INTO room_requests',
  'findDuplicateRequest',
  'missedEventsTruncated',
  'private async getDurableEvents',
  "url.pathname.endsWith('/diagnostics')",
  'Room diagnostics require room:manage',
])
  assert.ok(worker.includes(marker), `durable recovery/diagnostics are missing ${marker}`);

const durableEventsStart = worker.indexOf('private async getDurableEvents');
const durableEventsEnd = worker.indexOf('private async getHistory', durableEventsStart);
assert.ok(
  durableEventsStart >= 0 && durableEventsEnd > durableEventsStart,
  'durable replay handler is missing',
);
const durableEvents = worker.slice(durableEventsStart, durableEventsEnd);
assert.match(
  durableEvents,
  /scanDurableReplayRows\(rows,\s*\{[\s\S]*?latestEventSequence[,\s]/,
  'durable replay validation must receive the authoritative room event head',
);
assert.doesNotMatch(
  durableEvents,
  /JSON\.parse\(row\.event_json\)/,
  'durable replay must consume the event parsed by its integrity scan',
);

for (const marker of [
  'maximumInboundMessageBytes',
  'unsupported_protocol_version',
  'function isOriginAllowed',
  'origin_not_allowed',
  'payload_too_large',
])
  assert.ok(
    worker.includes(marker) || runtime.includes(marker),
    `origin/payload enforcement is missing ${marker}`,
  );

for (const sql of [migrationEvents, migrationRequests]) {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/i);
}
assert.match(migrationEvents, /room_events/i);
assert.match(migrationRequests, /room_requests/i);

for (const environment of ['staging', 'production'])
  assert.ok(deploy.includes(`"${environment}"`), `missing ${environment} Wrangler environment`);
assert.equal(
  (deploy.match(/"ALLOW_ANONYMOUS": "false"/g) ?? []).length,
  2,
  'staging and production must disable anonymous access',
);
assert.ok(
  deploy.includes('REPLACE_WITH_STAGING_D1_DATABASE_ID'),
  'staging D1 placeholder is missing',
);
assert.ok(
  deploy.includes('REPLACE_WITH_PRODUCTION_D1_DATABASE_ID'),
  'production D1 placeholder is missing',
);
assert.ok(deploy.includes('ROOM_TOKEN_REQUIRE_JTI'), 'token ID requirement is missing');
assert.ok(deploy.includes('ALLOWED_ORIGINS'), 'allowed-origin configuration is missing');

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        'Durable Object hibernation attachment restoration',
        'atomic bulk validation/commit before broadcast',
        'persistent request idempotency and long-range event recovery',
        'bounded D1 retry and persisted failure diagnostics',
        'manager-only room diagnostics',
        'origin, protocol, and payload-size enforcement',
        'staging/production secure deployment templates',
      ],
    },
    null,
    2,
  ),
);
