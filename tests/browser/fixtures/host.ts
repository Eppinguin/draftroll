import './host.css';
import {
  Draftroll,
  DraftrollOverlayRenderer,
  DraftrollTextRenderer,
  type DraftrollRoomRoll,
  type DraftrollRoomSession,
  type PhysicalDieModel,
  type RollVisibility,
} from '../../../packages/sdk/src/browser';

interface BrowserRollEvent {
  type: string;
  rollId: string;
  eventSequence: number;
  revision: number;
  hidden: boolean;
  total: number | null;
  replayed: boolean;
}

interface BrowserFixtureState {
  ready: boolean;
  status: string;
  overlayEnabled: boolean;
  overlayMounted: boolean;
  localPresentationCount: number;
  lastTotal: number | null;
  clickCount: number;
  cspViolations: Array<{ directive: string; blockedUri: string }>;
  roomConnected: boolean;
  roomOpenCount: number;
  roomCloseCount: number;
  roomId: string | null;
  participants: string[];
  roomEvents: BrowserRollEvent[];
  errors: string[];
}

interface BrowserFixtureApi {
  ready: Promise<void>;
  getState(): BrowserFixtureState;
  rollLocal(expression?: string): Promise<{ total: number; dice: number }>;
  rollLocalWithPhysicalModel(expression?: string): Promise<{ total: number; dice: number }>;
  connectRoom(options?: {
    roomId?: string;
    participantId?: string;
    sessionId?: string;
    name?: string;
  }): Promise<void>;
  rollRoom(
    expression?: string,
    visibility?: RollVisibility,
  ): Promise<{ rollId: string; hidden: boolean; total: number | null }>;
  revealLast(): Promise<{ rollId: string; revision: number; total: number | null }>;
  destroyOverlay(): void;
  closeRoom(): void;
  /**
   * Drops the live WebSocket the way a lost network would, without marking the close
   * intentional, so the client's reconnect and event-replay path runs.
   */
  dropConnection(): void;
}

declare global {
  interface Window {
    __draftrollTest: BrowserFixtureApi;
  }
}

const params = new URLSearchParams(location.search);
const textEnabled = params.get('text') === '1';
const overlayEnabled = !textEnabled && params.get('overlay') !== '0';
const rendererEnabled = overlayEnabled || textEnabled;
const overlayOrigin = params.get('overlayOrigin') ?? 'http://127.0.0.1:4174';
const readyTimeoutMs = Number(params.get('readyTimeoutMs') ?? 4_000);
const state: BrowserFixtureState = {
  ready: false,
  status: 'Booting',
  overlayEnabled,
  overlayMounted: false,
  localPresentationCount: 0,
  lastTotal: null,
  clickCount: 0,
  cspViolations: [],
  roomConnected: false,
  roomOpenCount: 0,
  roomCloseCount: 0,
  roomId: null,
  participants: [],
  roomEvents: [],
  errors: [],
};

let overlay: DraftrollOverlayRenderer | undefined;
let draftroll: Draftroll;
let roomSession: DraftrollRoomSession | null = null;
let lastRoomRoll: DraftrollRoomRoll | null = null;
// Tracks the socket the room client is currently using so a test can sever it. Playwright's
// `context.setOffline` does not close an already-established WebSocket, so it never triggers
// the reconnect path this fixture needs to exercise.
let liveSocket: WebSocket | null = null;

const TrackedWebSocket = new Proxy(WebSocket, {
  construct(target, args: [string | URL, (string | string[])?]) {
    const socket = new target(...args);
    liveSocket = socket;
    return socket;
  },
});

const browserCustomD6Model: PhysicalDieModel = {
  definition: {
    id: 'browser-custom-symbol-d6-v1',
    sides: 6,
    geometrySource: 'theme',
    targeting: 'relabel',
    radius: 0.96,
    collisionScale: 1.02,
    collider: { kind: 'box', halfExtents: [0.55, 0.55, 0.55] },
    outcomes: [
      {
        index: 0,
        value: 1,
        result: 1,
        numericValue: 1,
        supportNormals: [[-1, 0, 0]],
        labelAnchors: [
          {
            kind: 'face',
            faceIndex: 0,
            position: [0.561, 0, 0],
            normal: [1, 0, 0],
            up: [0, 1, 0],
            scale: 0.34,
          },
        ],
      },
      {
        index: 1,
        value: 2,
        result: 2,
        numericValue: 2,
        supportNormals: [[1, 0, 0]],
        labelAnchors: [
          {
            kind: 'face',
            faceIndex: 1,
            position: [-0.561, 0, 0],
            normal: [-1, 0, 0],
            up: [0, 1, 0],
            scale: 0.34,
          },
        ],
      },
      {
        index: 2,
        value: 3,
        result: 3,
        numericValue: 3,
        supportNormals: [[0, -1, 0]],
        labelAnchors: [
          {
            kind: 'face',
            faceIndex: 2,
            position: [0, 0.561, 0],
            normal: [0, 1, 0],
            up: [0, 0, -1],
            scale: 0.34,
          },
        ],
      },
      {
        index: 3,
        value: 4,
        result: 4,
        numericValue: 4,
        supportNormals: [[0, 1, 0]],
        labelAnchors: [
          {
            kind: 'face',
            faceIndex: 3,
            position: [0, -0.561, 0],
            normal: [0, -1, 0],
            up: [0, 0, 1],
            scale: 0.34,
          },
        ],
      },
      {
        index: 4,
        value: 5,
        result: 5,
        numericValue: 5,
        supportNormals: [[0, 0, -1]],
        labelAnchors: [
          {
            kind: 'face',
            faceIndex: 4,
            position: [0, 0, 0.561],
            normal: [0, 0, 1],
            up: [0, 1, 0],
            scale: 0.34,
          },
        ],
      },
      {
        index: 5,
        value: 6,
        result: 6,
        numericValue: 6,
        supportNormals: [[0, 0, 1]],
        labelAnchors: [
          {
            kind: 'face',
            faceIndex: 5,
            position: [0, 0, -0.561],
            normal: [0, 0, -1],
            up: [0, 1, 0],
            scale: 0.34,
          },
        ],
      },
    ],
  },
  presentation: {
    contents: [
      { kind: 'icon', icon: '◆', label: 'one' },
      { kind: 'icon', icon: '●', label: 'two' },
      { kind: 'icon', icon: '▲', label: 'three' },
      { kind: 'icon', icon: '■', label: 'four' },
      { kind: 'icon', icon: '★', label: 'five' },
      { kind: 'icon', icon: '✦', label: 'six' },
    ],
  },
};

const ready = initialize();
window.__draftrollTest = {
  ready,
  getState: () => structuredClone(state),
  rollLocal,
  rollLocalWithPhysicalModel,
  connectRoom,
  rollRoom,
  revealLast,
  destroyOverlay: () => {
    overlay?.destroy();
    state.overlayMounted = false;
    renderState();
  },
  closeRoom: () => roomSession?.close(),
  // 4900 carries no protocol meaning (4001-4003 are password/token cases the client treats as
  // intentional), so the client sees an unexpected close and runs reconnect + event replay.
  dropConnection: () => liveSocket?.close(4900, 'test transport drop'),
};

window.addEventListener('securitypolicyviolation', (event) => {
  state.cspViolations.push({
    directive: event.effectiveDirective || event.violatedDirective,
    blockedUri: event.blockedURI,
  });
  renderState();
});

document.querySelector('[data-testid="local-roll"]')?.addEventListener('click', () => {
  void rollLocal().catch(reportError);
});
document.querySelector('[data-testid="underlay-action"]')?.addEventListener('click', () => {
  state.clickCount += 1;
  renderState();
});

async function initialize(): Promise<void> {
  try {
    if (overlayEnabled) {
      overlay = new DraftrollOverlayRenderer({
        src: `${overlayOrigin}/overlay.html`,
        targetOrigin: overlayOrigin,
        readyTimeoutMs,
        dismissOnPointer: true,
        dismissDurationMs: 120,
        results: false,
        referrerPolicy: 'no-referrer',
        sandbox: ['allow-scripts', 'allow-same-origin'],
      });
      await overlay.mount();
      state.overlayMounted = true;
      draftroll = new Draftroll({ renderer: overlay });
    } else if (textEnabled) {
      const container = document.querySelector<HTMLElement>('[data-testid="text-results"]');
      if (!container) throw new Error('Missing text result region');
      draftroll = new Draftroll({ renderer: new DraftrollTextRenderer({ container }) });
    } else {
      draftroll = new Draftroll();
    }

    if (params.get('connect') === '1') {
      await connectRoom({
        roomId: params.get('roomId') ?? undefined,
        participantId: params.get('participantId') ?? undefined,
        sessionId: params.get('sessionId') ?? undefined,
        name: params.get('name') ?? undefined,
      });
    }
    state.ready = true;
    setStatus('Ready');
  } catch (error) {
    reportError(error);
    throw error;
  }
}

async function rollLocal(
  expression = '1d20+1d8+1d2+1dF+1d9',
): Promise<{ total: number; dice: number }> {
  await ready;
  const roll = draftroll.roll(expression, {
    render: rendererEnabled,
    renderer: { animationDurationMs: 720 },
  });
  await roll.wait();
  state.localPresentationCount += 1;
  state.lastTotal = roll.total;
  setStatus('Local roll complete');
  renderState();
  return { total: roll.total, dice: roll.dice.length };
}

async function rollLocalWithPhysicalModel(
  expression = '1d6',
): Promise<{ total: number; dice: number }> {
  await ready;
  const roll = draftroll.roll(expression, {
    render: rendererEnabled,
    renderer: {
      physicalModels: { d6: browserCustomD6Model },
    },
  });
  await roll.wait();
  state.localPresentationCount += 1;
  state.lastTotal = roll.total;
  setStatus('Custom physical roll complete');
  renderState();
  return { total: roll.total, dice: roll.dice.length };
}

async function connectRoom(
  options: { roomId?: string; participantId?: string; sessionId?: string; name?: string } = {},
): Promise<void> {
  if (roomSession) return;
  if (!draftroll) await ready;
  const roomId = options.roomId ?? `browser-${crypto.randomUUID()}`;
  roomSession = await draftroll.connectRoom({
    url: `ws://127.0.0.1:8787/rooms/${encodeURIComponent(roomId)}/connect`,
    roomId,
    participant: {
      participantId: options.participantId ?? `participant-${crypto.randomUUID()}`,
      sessionId: options.sessionId ?? `session-${crypto.randomUUID()}`,
      name: options.name ?? 'Browser participant',
    },
    WebSocketImpl: TrackedWebSocket,
    reconnect: true,
    reconnectDelayMs: 150,
    clockSyncSamples: 1,
    requestTimeoutMs: 6_000,
    autoPresent: overlayEnabled,
    renderer: { animationDurationMs: 720, lateEvent: { mode: 'auto' } },
  });
  state.roomId = roomId;
  state.roomConnected = true;
  state.roomOpenCount = 1;
  syncParticipants();

  roomSession.room.on('open', () => {
    state.roomConnected = true;
    state.roomOpenCount += 1;
    syncParticipants();
    renderState();
  });
  roomSession.room.on('close', () => {
    state.roomConnected = false;
    state.roomCloseCount += 1;
    renderState();
  });
  roomSession.room.on('rollStart', recordRoomEvent);
  roomSession.room.on('rollUpdate', recordRoomEvent);
  roomSession.room.on('rollVisibilityUpdate', recordRoomEvent);
  roomSession.on('participantJoined', syncParticipants);
  roomSession.on('participantUpdated', syncParticipants);
  roomSession.on('participantLeft', syncParticipants);
  roomSession.on('error', ({ error }) => reportError(error));
  setStatus('Room connected');
  renderState();
}

async function rollRoom(
  expression = '1d20+4',
  visibility: RollVisibility = { type: 'public' },
): Promise<{ rollId: string; hidden: boolean; total: number | null }> {
  await ready;
  if (!roomSession) await connectRoom();
  lastRoomRoll = await roomSession!.roll({ expression, name: 'Browser test roll' }, { visibility });
  await lastRoomRoll.wait();
  return {
    rollId: lastRoomRoll.id,
    hidden: lastRoomRoll.hidden,
    total: lastRoomRoll.result?.total ?? null,
  };
}

async function revealLast(): Promise<{ rollId: string; revision: number; total: number | null }> {
  if (!lastRoomRoll) throw new Error('No room roll is available to reveal');
  lastRoomRoll = await lastRoomRoll.reveal();
  await lastRoomRoll.wait();
  return {
    rollId: lastRoomRoll.id,
    revision: lastRoomRoll.revision,
    total: lastRoomRoll.result?.total ?? null,
  };
}

function recordRoomEvent(event: {
  type: string;
  rollId: string;
  eventSequence: number;
  summary: { revision: number };
  hidden: boolean;
  result: { total: number } | null;
  replayed?: boolean;
}): void {
  const entry: BrowserRollEvent = {
    type: event.type,
    rollId: event.rollId,
    eventSequence: event.eventSequence,
    revision: event.summary.revision,
    hidden: event.hidden,
    total: event.result?.total ?? null,
    replayed: event.replayed === true,
  };
  const existing = state.roomEvents.findIndex(
    (candidate) =>
      candidate.rollId === entry.rollId &&
      candidate.type === entry.type &&
      candidate.revision === entry.revision &&
      candidate.eventSequence === entry.eventSequence,
  );
  if (existing >= 0) state.roomEvents[existing] = entry;
  else state.roomEvents.push(entry);
  renderState();
}

function syncParticipants(): void {
  state.participants =
    roomSession?.room.participants
      .map((participant) => participant.name)
      .toSorted((left, right) => left.localeCompare(right)) ?? [];
  renderState();
}

function reportError(value: unknown): void {
  const error = value instanceof Error ? value : new Error(String(value));
  state.errors.push(error.message);
  setStatus(`Error: ${error.message}`);
  renderState();
}

function setStatus(value: string): void {
  state.status = value;
  const element = document.querySelector<HTMLElement>('[data-testid="status"]');
  if (element) element.textContent = value;
}

function renderState(): void {
  const clickCount = document.querySelector<HTMLElement>('[data-testid="click-count"]');
  if (clickCount) clickCount.textContent = String(state.clickCount);
  const total = document.querySelector<HTMLElement>('[data-testid="last-total"]');
  if (total) total.textContent = state.lastTotal === null ? '—' : String(state.lastTotal);
  const output = document.querySelector<HTMLElement>('[data-testid="state"]');
  if (output) output.textContent = JSON.stringify(state, null, 2);
}
