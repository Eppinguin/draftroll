import assert from 'node:assert/strict';

const baseUrlValue = process.env.DRAFTROLL_BASE_URL;
const roomId = process.env.DRAFTROLL_ROOM_ID;
const token = process.env.DRAFTROLL_ROOM_TOKEN;
const timeoutMs = readNonNegativeNumber(process.env.DRAFTROLL_HEALTH_TIMEOUT_MS, 10_000);
if (!baseUrlValue) {
  console.error('Set DRAFTROLL_BASE_URL. Set DRAFTROLL_ROOM_ID and DRAFTROLL_ROOM_TOKEN for manager diagnostics.');
  process.exit(2);
}

const baseUrl = new URL(baseUrlValue);
const healthResponse = await fetchChecked(new URL('/health', baseUrl));
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.ok, true);
assert.equal(health.protocolVersion, 2);
if (process.env.DRAFTROLL_EXPECT_ENV) assert.equal(health.environment, process.env.DRAFTROLL_EXPECT_ENV);

let diagnostics;
if (roomId) {
  if (!token) throw new Error('DRAFTROLL_ROOM_TOKEN is required with DRAFTROLL_ROOM_ID');
  const url = new URL(`/rooms/${encodeURIComponent(roomId)}/diagnostics`, baseUrl);
  url.searchParams.set('protocolVersion', '2');
  url.searchParams.set('participantId', process.env.DRAFTROLL_PARTICIPANT_ID ?? 'operations-probe');
  url.searchParams.set('sessionId', process.env.DRAFTROLL_SESSION_ID ?? `operations-${Date.now().toString(36)}`);
  url.searchParams.set('name', 'Operations probe');
  const response = await fetchChecked(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200, `diagnostics returned HTTP ${response.status}`);
  diagnostics = await response.json();
  const maximumPersistenceFailures = readNonNegativeNumber(process.env.DRAFTROLL_MAX_PERSISTENCE_FAILURES, 0);
  const maximumBufferedEvents = readNonNegativeNumber(process.env.DRAFTROLL_MAX_BUFFERED_EVENTS, Number.POSITIVE_INFINITY);
  const minimumReadyRatio = readRatio(process.env.DRAFTROLL_MIN_RENDERER_READY_RATIO, 0);
  const persistenceFailures = Number(diagnostics.persistenceFailures ?? 0);
  const bufferedEvents = Number(diagnostics.bufferedEvents ?? 0);
  const authorizedSessions = Number(diagnostics.authorizedSessions ?? 0);
  const rendererReadySessions = Number(diagnostics.rendererReadySessions ?? 0);
  const readyRatio = authorizedSessions > 0 ? rendererReadySessions / authorizedSessions : 1;
  assert.ok(persistenceFailures <= maximumPersistenceFailures, `persistence failure budget exceeded: ${persistenceFailures} > ${maximumPersistenceFailures}`);
  assert.ok(bufferedEvents <= maximumBufferedEvents, `buffered event budget exceeded: ${bufferedEvents} > ${maximumBufferedEvents}`);
  assert.ok(readyRatio >= minimumReadyRatio, `renderer-ready ratio below threshold: ${readyRatio} < ${minimumReadyRatio}`);
}

console.log(JSON.stringify({
  ok: true,
  checkedAt: new Date().toISOString(),
  health,
  diagnostics,
}, null, 2));

async function fetchChecked(url, init = {}) {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
}

function readNonNegativeNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if ((!Number.isFinite(parsed) && parsed !== Number.POSITIVE_INFINITY) || parsed < 0) throw new Error('Health thresholds must be non-negative numbers');
  return parsed;
}

function readRatio(value, fallback) {
  const parsed = readNonNegativeNumber(value, fallback);
  if (parsed > 1) throw new Error('DRAFTROLL_MIN_RENDERER_READY_RATIO must be between 0 and 1');
  return parsed;
}
