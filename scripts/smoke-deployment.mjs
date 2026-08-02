import assert from 'node:assert/strict';

const baseUrlValue = process.env.DRAFTROLL_BASE_URL;
if (!baseUrlValue) {
  console.error(
    'Set DRAFTROLL_BASE_URL to the deployed Worker origin, for example https://dice.example.com',
  );
  process.exit(2);
}

const baseUrl = new URL(baseUrlValue);
const expectedEnvironment = process.env.DRAFTROLL_EXPECT_ENV;
const expectedAnonymous = parseOptionalBoolean(process.env.DRAFTROLL_EXPECT_ANONYMOUS);
const origin = process.env.DRAFTROLL_SMOKE_ORIGIN;
const token = process.env.DRAFTROLL_SMOKE_TOKEN;
const roomPassword = process.env.DRAFTROLL_SMOKE_ROOM_PASSWORD;
const roomId = process.env.DRAFTROLL_SMOKE_ROOM_ID;
const participantId = process.env.DRAFTROLL_SMOKE_PARTICIPANT_ID ?? 'deployment-smoke';
const sessionId =
  process.env.DRAFTROLL_SMOKE_SESSION_ID ?? `deployment-smoke-${Date.now().toString(36)}`;
const timeoutMs = readPositiveInteger(process.env.DRAFTROLL_SMOKE_TIMEOUT_MS, 10_000);

const headers = {};
if (origin) headers.Origin = origin;
if (token) headers.Authorization = `Bearer ${token}`;
if (roomPassword) headers['X-Draftroll-Room-Password'] = roomPassword;

const service = await requestJson(new URL('/', baseUrl), { headers });
assert.equal(
  service.response.status,
  200,
  `service metadata returned HTTP ${service.response.status}`,
);
assert.equal(service.body.service, 'draftroll-room');
assert.equal(service.body.protocolVersion, 2);
if (expectedEnvironment) assert.equal(service.body.environment, expectedEnvironment);
if (expectedAnonymous !== undefined) {
  assert.equal(service.body.access === 'anonymous-or-capability-token', expectedAnonymous);
}

const health = await requestJson(new URL('/health', baseUrl), { headers });
assert.equal(health.response.status, 200, `health returned HTTP ${health.response.status}`);
assert.equal(health.body.ok, true);
assert.equal(health.body.protocolVersion, 2);

const checks = ['service metadata', 'health and protocol version'];
let roomStateSummary;
if (roomId) {
  const stateUrl = new URL(`/rooms/${encodeURIComponent(roomId)}/state`, baseUrl);
  stateUrl.searchParams.set('protocolVersion', '2');
  stateUrl.searchParams.set('participantId', participantId);
  stateUrl.searchParams.set('sessionId', sessionId);
  stateUrl.searchParams.set('name', 'Deployment smoke');
  const state = await requestJson(stateUrl, { headers });
  assert.equal(
    state.response.status,
    200,
    `room state returned HTTP ${state.response.status}: ${JSON.stringify(state.body)}`,
  );
  assert.equal(state.body.type, 'room_state');
  assert.equal(state.body.roomId, roomId);
  assert.equal(state.body.protocolVersion, 2);
  assert.ok(Array.isArray(state.body.recentEvents));
  assert.ok(Array.isArray(state.body.recentRolls));
  roomStateSummary = {
    roomId,
    latestEventSequence: state.body.latestEventSequence,
    policyRevision: state.body.policyRevision,
  };
  checks.push('authorized room-state projection');
}

if (origin) {
  const allowedOrigin = health.response.headers.get('access-control-allow-origin');
  assert.equal(allowedOrigin, origin, 'configured smoke origin was not reflected by CORS');
  checks.push('allowed-origin CORS projection');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl: baseUrl.origin,
      environment: service.body.environment,
      access: service.body.access,
      roomState: roomStateSummary,
      checks,
    },
    null,
    2,
  ),
);

async function requestJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${url} returned non-JSON content: ${text.slice(0, 200)}`);
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('DRAFTROLL_EXPECT_ANONYMOUS must be true or false');
}

function readPositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error('DRAFTROLL_SMOKE_TIMEOUT_MS must be a positive integer');
  return parsed;
}
