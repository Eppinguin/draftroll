import './host.css';
import {
  Draftroll,
  DraftrollOverlayRenderer,
  DraftrollTextRenderer,
  type DraftrollRoomRoll,
  type DraftrollRoomSession,
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
  connectRoom(options?: { roomId?: string; participantId?: string; sessionId?: string; name?: string }): Promise<void>;
  rollRoom(expression?: string, visibility?: RollVisibility): Promise<{ rollId: string; hidden: boolean; total: number | null }>;
  revealLast(): Promise<{ rollId: string; revision: number; total: number | null }>;
  destroyOverlay(): void;
  closeRoom(): void;
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

const ready = initialize();
window.__draftrollTest = {
  ready,
  getState: () => structuredClone(state),
  rollLocal,
  connectRoom,
  rollRoom,
  revealLast,
  destroyOverlay: () => {
    overlay?.destroy();
    state.overlayMounted = false;
    renderState();
  },
  closeRoom: () => roomSession?.close(),
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

async function rollLocal(expression = '1d20+1d8+1d2+1dF+1d9'): Promise<{ total: number; dice: number }> {
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

async function connectRoom(options: { roomId?: string; participantId?: string; sessionId?: string; name?: string } = {}): Promise<void> {
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
  const existing = state.roomEvents.findIndex((candidate) =>
    candidate.rollId === entry.rollId
      && candidate.type === entry.type
      && candidate.revision === entry.revision
      && candidate.eventSequence === entry.eventSequence,
  );
  if (existing >= 0) state.roomEvents[existing] = entry;
  else state.roomEvents.push(entry);
  renderState();
}

function syncParticipants(): void {
  state.participants = roomSession?.room.participants.map((participant) => participant.name).toSorted((left, right) => left.localeCompare(right)) ?? [];
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
