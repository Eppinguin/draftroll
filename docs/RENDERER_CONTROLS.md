# Renderer lifecycle and controls

`DiceRenderer` exposes a renderer-neutral lifecycle. `DraftrollRenderer`, `DraftrollTextRenderer`, and the iframe overlay implement the applicable subset.

## Lifecycle events

```ts
const stop = renderer.on?.('completed', ({ result, completion }) => {
  console.log(result.rollId, completion.total);
});
```

Events are:

- `loading`
- `started`
- `settled`
- `completed`
- `dissolveStarted`
- `dissolveFinished`
- `paused`
- `resumed`
- `cleared`
- `error`

`settled` means the authoritative visual state is established. `completed` means the renderer's presentation promise is complete. Listener failures are isolated from presentation behavior.

## Reroll and explosion sequencing

Expression-generated rerolls, reroll-add dice, and explosions are staged by default. Initial dice are rolled first. After they settle, generated dice are appended to the same table in causal waves; recursive explosions and reroll-until-clear therefore remain visibly distinct rolls. The final total is not supplied to the visual result panel until the last wave settles.

```ts
await renderer.playRoll(result, {
  modifierSequence: 'staged', // default
});
```

Use `modifierSequence: 'simultaneous'` only when a host intentionally wants the older single-throw presentation. Reduced-motion presentations use one final state. Ordinary realtime latency still stages modifiers: only events already beyond the configured late-event settled threshold catch up directly to the final state.

Generated normalized dice expose `generatedFromDieId`, allowing renderers and logs to reconstruct the immediate reroll or explosion cause without inferring it from array position.

The evaluator resolves the complete deterministic roll before animation so every physical target is reproducible. Treat `SdkRollResponse.result` as internal/pending data while a presentation is active: user-facing totals and die values should remain hidden until `await response.wait()` (or `await response.presentation`) resolves. The overlay and included character-sheet client follow this rule automatically.

## Persistence and auto-clear

A presentation remains until dismissed by default. Set `autoClearMs` per call to dissolve and clear after a bounded delay. The text renderer also supports `persistent` and `maximumEntries` for an accessible retained log.

## Manual controls

```ts
await renderer.pause?.();
await renderer.resume?.();
await renderer.configureCamera?.({ yaw: 0.4, pitch: 0.7, zoom: 1.1, autoRotate: false });
await renderer.resetCamera?.();
const image = await renderer.screenshot?.();
await renderer.preview?.({ themeId: 'dragon', dieType: 'd20', value: 20 });
renderer.setParticipantFilter?.(['player-a', 'player-b']);
await renderer.configureInteractions?.({ click: 'reroll', draggable: true });
```

Camera values are constrained by the renderer. Screenshots return a `Blob` or data URL depending on the bridge. Preview uses the normal constrained theme path and does not bypass asset validation.

## Physical interaction events

The browser bridge supports click actions `none`, `reroll`, `drop`, and `explode`, plus settled-die dragging. It emits `draftroll:die-interaction` with the action, die index, value, and final position. The SDK only supplies a reroll callback automatically; drop/explode remain application-owned decisions because their rules semantics vary.

## Participant filters

Filtering is presentation-only. It does not change server authorization or history. Use room visibility for privacy; use renderer filtering to choose which already-authorized rolls appear on a display.
