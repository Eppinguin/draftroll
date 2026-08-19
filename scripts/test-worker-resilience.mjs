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

function sectionIncludes(source, start, end, marker) {
  const index = source.indexOf(marker, start);
  return index >= start && index < end;
}

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
for (const marker of [
  'Validate and evaluate every mutation before committing any state',
  'assertRevision(previous.result, item.expectedRevision, item.rollId)',
  'await this.state.storage.put(storageEntries)',
  'for (const internal of internalEvents) this.broadcastRoll(internal)',
  'this.persistEventSafely(acknowledgement, policy)',
])
  assert.ok(
    sectionIncludes(worker, bulkStart, bulkEnd, marker),
    `bulk update atomicity/idempotency is missing ${marker}`,
  );
assert.ok(
  worker.indexOf('await this.state.storage.put(storageEntries)', bulkStart) <
    worker.indexOf('for (const internal of internalEvents) this.broadcastRoll(internal)', bulkStart),
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
  'durable event replay is missing',
);
for (const marker of [
  'migrateStoredInternalEvent(JSON.parse(row.event_json))',
  "this.logStructured('room.event_storage_invalid'",
  "source: 'd1_replay'",
])
  assert.ok(
    sectionIncludes(worker, durableEventsStart, durableEventsEnd, marker),
    `D1 replay corruption handling is missing ${marker}`,
  );

const eventBufferStart = worker.indexOf('private async getEventBuffer');
const eventBufferEnd = worker.indexOf('private async recordRequest', eventBufferStart);
assert.ok(
  eventBufferStart >= 0 && eventBufferEnd > eventBufferStart,
  'event buffer reader is missing',
);
for (const marker of [
  "this.state.storage.get('eventBuffer')",
  'Array.isArray(stored)',
  'migrateStoredInternalEvent(event)',
  "source: 'durable_object_buffer'",
])
  assert.ok(
    sectionIncludes(worker, eventBufferStart, eventBufferEnd, marker),
    `Durable Object event-buffer hardening is missing ${marker}`,
  );

const duplicateStart = worker.indexOf('private async findDuplicateRequest');
const duplicateEnd = worker.indexOf('private async nextRollSequence', duplicateStart);
assert.ok(
  duplicateStart >= 0 && duplicateEnd > duplicateStart,
  'duplicate request lookup is missing',
);
for (const marker of [
  "'idempotency_replay_unavailable'",
  "source: 'idempotency_replay'",
  'migrateStoredInternalEvent(JSON.parse(serialized))',
])
  assert.ok(
    sectionIncludes(worker, duplicateStart, duplicateEnd, marker),
    `fail-closed idempotency replay is missing ${marker}`,
  );
assert.equal(
  sectionIncludes(worker, duplicateStart, duplicateEnd, 'if (!serialized) return null'),
  false,
  'a recorded request must not be re-executed when its retained response is unavailable',
);
assert.ok(
  worker.includes('sendEvent(socket, toRollError(error, event.requestId))'),
  'idempotency replay failures must be returned to the requester instead of escaping the socket handler',
);

const storedMigrationStart = worker.indexOf('function migrateStoredInternalEvent(event: unknown)');
const storedMigrationEnd = worker.indexOf('function projectInternalEvent', storedMigrationStart);
assert.ok(
  storedMigrationStart >= 0 && storedMigrationEnd > storedMigrationStart,
  'stored event migration boundary is missing',
);
for (const marker of [
  'isRecord(event)',
  "case 'roll_start'",
  "case 'roll_updated'",
  "case 'roll_visibility_updated'",
  'decodeNormalizedRollResult(event.result, { allowLegacyResults: true })',
  'Stored room event has unsupported type',
])
  assert.ok(
    sectionIncludes(worker, storedMigrationStart, storedMigrationEnd, marker),
    `stored event migration validation is missing ${marker}`,
  );

const sendStart = worker.indexOf('function sendEvent');
const sendEnd = worker.indexOf('interface HibernatableWebSocket', sendStart);
assert.ok(sendStart >= 0 && sendEnd > sendStart, 'server event sender is missing');
assert.ok(
  sectionIncludes(worker, sendStart, sendEnd, 'allowLegacyResults: false'),
  'outbound server events must reject legacy results instead of repairing them on the wire',
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
        'fail-closed idempotency replay when retained responses are missing or invalid',
        'legacy-result migration and corruption isolation at persisted event read boundaries',
        'strict current-schema outbound server events',
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
