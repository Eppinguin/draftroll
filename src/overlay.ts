import './main';
import './overlay.css';
import {
  DRAFTROLL_HOST_SOURCE,
  DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
  DRAFTROLL_OVERLAY_SOURCE,
  type DraftrollHostMessage,
  type DraftrollOverlayMessage,
} from '../packages/overlay/src/index';
import { DraftrollRenderer, type DraftrollEffectOutcome } from '../packages/renderer/src/index';

const overlayRenderer = new DraftrollRenderer({ bridge: window.draftrollDice });

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !isHostMessage(event.data)) return;
  void handleCommand(event.data, event);
});

postToParent({
  source: DRAFTROLL_OVERLAY_SOURCE,
  version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
  type: 'ready',
});

async function handleCommand(message: DraftrollHostMessage, event: MessageEvent): Promise<void> {
  try {
    if (message.type === 'warmup') {
      await overlayRenderer.warmup(message.themeIds);
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion: null,
      });
      return;
    }

    if (message.type === 'install-theme') {
      await window.draftrollDice.installTheme(message.bundle);
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion: null,
      });
      return;
    }

    if (message.type === 'unload-theme') {
      window.draftrollDice.unloadTheme(message.themeId);
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion: null,
      });
      return;
    }

    if (message.type === 'configure') {
      window.draftrollDice.configure({
        adaptiveQuality: message.options.adaptiveQuality,
        performanceProfile: message.options.profile,
        maximumPixelRatio: message.options.maximumPixelRatio,
        activeFramesPerSecond: message.options.activeFramesPerSecond,
      });
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion: null,
      });
      return;
    }

    if (message.type === 'pause') {
      await window.draftrollDice.pause();
      respond(event, complete(message.requestId));
      return;
    }

    if (message.type === 'resume') {
      await window.draftrollDice.resume();
      respond(event, complete(message.requestId));
      return;
    }

    if (message.type === 'configure-camera') {
      await window.draftrollDice.configureCamera(message.options);
      respond(event, complete(message.requestId));
      return;
    }

    if (message.type === 'reset-camera') {
      await window.draftrollDice.resetCamera();
      respond(event, complete(message.requestId));
      return;
    }

    if (message.type === 'configure-interactions') {
      await window.draftrollDice.configureInteractions(message.options);
      respond(event, complete(message.requestId));
      return;
    }

    if (message.type === 'screenshot') {
      const dataUrl = await window.draftrollDice.screenshot();
      respond(event, { ...complete(message.requestId), dataUrl });
      return;
    }

    if (message.type === 'preview') {
      const completion = await window.draftrollDice.preview(message.options);
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion,
      });
      return;
    }

    if (message.type === 'dismiss') {
      await window.draftrollDice.dismiss(message.options);
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion: null,
      });
      return;
    }

    if (message.type === 'clear') {
      window.draftrollDice.clear();
      respond(event, {
        source: DRAFTROLL_OVERLAY_SOURCE,
        version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
        type: 'complete',
        requestId: message.requestId,
        completion: null,
      });
      return;
    }

    // `message.type` narrows to `never` here; stringify defensively for the runtime case
    // where a host posts a message type this build does not know about.
    if (message.type !== 'play')
      throw new Error(`Unsupported overlay message type: ${String(message.type)}`);

    const outcomeById = new Map<string, DraftrollEffectOutcome>();
    message.result.dice.forEach((die, index) => {
      const outcome = message.outcomes?.[index];
      if (outcome) outcomeById.set(die.id, outcome);
    });
    const completion = await overlayRenderer.playRoll(message.result, {
      ...message.options,
      outcomeResolver: message.outcomes ? (die) => outcomeById.get(die.id) ?? 'neutral' : undefined,
    });
    respond(event, {
      source: DRAFTROLL_OVERLAY_SOURCE,
      version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
      type: 'complete',
      requestId: message.requestId,
      completion,
    });
  } catch (error) {
    respond(event, {
      source: DRAFTROLL_OVERLAY_SOURCE,
      version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function isHostMessage(value: unknown): value is DraftrollHostMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DraftrollHostMessage>;
  return (
    candidate.source === DRAFTROLL_HOST_SOURCE &&
    candidate.version === DRAFTROLL_OVERLAY_PROTOCOL_VERSION &&
    (candidate.type === 'warmup' ||
      candidate.type === 'install-theme' ||
      candidate.type === 'unload-theme' ||
      candidate.type === 'configure' ||
      candidate.type === 'play' ||
      candidate.type === 'dismiss' ||
      candidate.type === 'clear' ||
      candidate.type === 'pause' ||
      candidate.type === 'resume' ||
      candidate.type === 'configure-camera' ||
      candidate.type === 'reset-camera' ||
      candidate.type === 'configure-interactions' ||
      candidate.type === 'screenshot' ||
      candidate.type === 'preview') &&
    typeof candidate.requestId === 'string'
  );
}

function complete(requestId: string): Extract<DraftrollOverlayMessage, { type: 'complete' }> {
  return {
    source: DRAFTROLL_OVERLAY_SOURCE,
    version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
    type: 'complete',
    requestId,
    completion: null,
  };
}

function respond(event: MessageEvent, message: DraftrollOverlayMessage): void {
  const target = event.source;
  // `MessageEventSource` also covers MessagePort and ServiceWorker, whose postMessage
  // signatures differ; only a Window accepts a target origin. `instanceof Window` cannot
  // be used here: a cross-origin parent arrives as a WindowProxy from another realm, so
  // the check is false for exactly the embedded case this overlay exists to serve.
  // Windows are distinguishable from ports/workers by carrying a `window` self-reference.
  if (!target || !('window' in target) || target.window !== target) return;
  target.postMessage(message, event.origin === 'null' ? '*' : event.origin);
}

function postToParent(message: DraftrollOverlayMessage): void {
  window.parent.postMessage(message, '*');
}
