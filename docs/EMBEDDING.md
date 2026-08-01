# Embedding Draftroll over another website

Draftroll's production renderer is a transparent SDK-owned iframe. The host application keeps ownership of its layout, CSS, controls, character data, and dice log. Draftroll places only the WebGL dice layer above the host page.

This prevents Three.js, Cannon-es, renderer styles, workers, and WebGL state from leaking into the host application.

## Build the renderer overlay

```bash
pnpm install
pnpm build:overlay
```

The renderer output is written to:

```text
dist-overlay/
  draftroll/
    overlay.html
    assets/
```

Copy the complete `draftroll` directory into the host application's public assets. The test character sheet is not included in this build.

## Mount over an application

```ts
import { Draftroll } from '@draftroll/sdk';

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    dismissOnPointer: true,
    results: {
      position: 'bottom-right',
      title: 'Latest roll',
      showThemes: true,
    },
  },
  warmupThemes: ['dragon', 'frost'],
});
```

The iframe is fixed over the viewport, has a transparent background, and uses `pointer-events: none`. Buttons, forms, scrolling, and other controls below it continue to work normally.

No physical dice are created during mount or warmup. The host page remains visually unchanged until the first roll starts.

## Power and performance profile

The overlay uses an idle-zero render loop. It requests frames only while a roll, physical preview, camera transition, or outcome effect is active.

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    performance: {
      profile: 'auto', // auto | battery | quality
    },
  },
});
```

Use `battery` to cap active rendering at 30 FPS, cap DPR at 1, disable dynamic shadows, and reduce secondary effects. See `docs/PERFORMANCE.md` for custom limits, queue behavior, diagnostics, and benchmarks.

## Roll over the host page

```ts
const attack = draftroll.roll('1d20 + 1d4 + 7', {
  name: 'Mara Voss',
  metadata: {
    actionName: 'Blessed shot',
  },
  themes: ['dragon', 'celestial'],
});

console.log(attack.total);
await attack.wait();
```

The d20 and d4 are thrown in one synchronized physical simulation above the existing page.

Supported mixed physical kinds are:

```text
d4, d6, d8, d10, d12, d20
```

## Completed-dice dismissal

`dismissOnPointer` defaults to `true`. After a physical roll finishes, the next pointer click anywhere in the host document dissolves the visible dice. The click is not consumed, so it can still activate the underlying application control.

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    dismissOnPointer: true,
    dismissIgnoreSelector: '[data-draftroll-roll-control]',
    dismissDurationMs: 360,
    dismissResultPanel: true,
  },
});
```

Manual control is also available:

```ts
await draftroll.dismiss({ durationMs: 240 });
await draftroll.clearDice(); // immediate removal
```

Starting another local roll during the same pointer gesture cancels the pending dismissal. For asynchronous room requests, mark roll controls with the configured `dismissIgnoreSelector` so settled table dice remain available until the authoritative event arrives. Other clicks still dissolve the table.

## Built-in result display

The result panel is part of the overlay SDK, but it is rendered in the host document through Shadow DOM so it can remain interactive.

It can show:

- character or roller name
- normalized total
- expression
- authority
- individual results
- kept and dropped dice
- per-die themes
- optional individual-reroll buttons

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    results: {
      enabled: true,
      position: 'top-right',
      title: 'Attack result',
      showExpression: true,
      showAuthority: false,
      showThemes: true,
      allowReroll: true,
    },
  },
});
```

Use `results: false` when the host application provides its own transient result UI.

## Per-die themes

Array assignment follows normalized dice order:

```ts
draftroll.roll('1d20 + 1d8 + 2d6', {
  themes: ['dragon', 'frost', 'ember', 'wildwood'],
});
```

A resolver is useful for game rules:

```ts
draftroll.roll('4d6kh3', {
  themes: (die, index) => {
    if (!die.kept) return 'necrotic';
    return index % 2 === 0 ? 'celestial' : 'wildwood';
  },
});
```

## Present server-authoritative results

A room integration can retain the result's original authority and identity:

```ts
room.on('rollStart', (event) => {
  const presentation = draftroll.present(event.result, {
    startTime: event.localStartTimeMs,
    animationSeed: event.animationSeed,
  });

  void presentation.wait();
});
```

For a log-only room revision:

```ts
room.on('rollUpdate', (event) => {
  if (event.animate) {
    draftroll.present(event.result, {
      startTime: event.localStartTimeMs,
      animationSeed: event.animationSeed,
    });
  } else {
    draftroll.presentUpdate(event.result);
  }
});
```

## Reroll and revise

```ts
const damage = draftroll.roll('2d6 + 1d8 + 3');
await damage.wait();

const oneDie = damage.rerollDie('die_2');
await oneDie.wait();

// The original dice stay on the table. The selected die is marked discarded,
// and its replacement is appended as a new physical throw. Repeated rerolls
// retain the complete visible history until the table is cleared or dismissed.

const revised = oneDie.animateUpdate({
  expression: '3d6 + 1d8 + 4',
}, {
  reroll: true,
});
await revised.wait();

revised.updateLog({
  annotation: 'GM corrected the label',
});
```


Individual SDK rerolls preserve the existing table by default. The prior physical die remains visible as discarded history, while the replacement is appended and rolled normally. Repeated rerolls retain every previous replacement, with only the newest logical result kept, and all revisions remain one logical table roll. Additive stages do not invoke bridge quantity/theme setters because browser implementations may rebuild the scene when those setters run. A reroll initiated from the built-in result panel also takes ownership of the presentation synchronously, before deferred click-to-dismiss logic can clear the table. The same options are forwarded through the iframe overlay and realtime room presentation path. Set `renderer.preservePreviousDice` to `false` for legacy replacement behavior. If the table has already been cleared, dismissed, auto-cleared, or cannot accept another visual, the renderer safely falls back to presenting the complete revised result rather than an orphaned replacement die.

While a presentation is pending, the built-in result panel and supplied test-client log do not render one placeholder per deterministic result die. They show a single pending message and reveal totals, die rows, reroll/explosion descendants, and their count only after the final physical stage settles.

## Container-scoped overlay

By default the iframe covers the viewport. A host can scope it to a positioned application shell:

```ts
const shell = document.querySelector<HTMLElement>('#game-shell');
if (!shell) throw new Error('Missing game shell');
shell.style.position = 'relative';

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    container: shell,
  },
});
```

## Cross-origin renderer hosting

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: 'https://dice-cdn.example.com/draftroll/overlay.html',
    targetOrigin: 'https://dice-cdn.example.com',
  },
});
```

The host CSP must allow the renderer origin in `frame-src`. The renderer origin must allow its own scripts, workers, and assets.

## Remaining renderer gaps

- Dedicated physical meshes and custom face painting for every arbitrary or symbolic die remain optional enhancements; synchronized fallback visuals are implemented.
- Explicit manual pause/resume, screenshot, camera, draggable-dice, and click-to-reroll controls remain optional.
- Controlled real-device performance baselines are not yet recorded.

## Runtime theme provider

Runtime themes are loaded by the host SDK and installed into the renderer iframe through the versioned overlay protocol. This preserves iframe isolation while allowing application-owned theme catalogs.

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    themeProvider,
    fallbackThemeId: 'dragon',
    maximumThemeAssetBytes: 8 * 1024 * 1024,
    maximumThemeTotalBytes: 24 * 1024 * 1024,
    onThemeLoad: console.debug,
  },
});
```

When `strictThemes` is false, a missing or invalid runtime theme uses the configured fallback theme. Set it to true in development when theme failures should reject the presentation.
