# Browser integration automation

Draftroll uses Playwright for behavior that cannot be validated reliably through source inspection or Node-only tests: WebGL, iframe isolation, CSP, browser WebSockets, pointer passthrough, responsive layouts, and reconnect timing.

The suite is deliberately separate from `test:core`. It starts local-only processes and does not deploy or modify remote resources.

## Install

```bash
pnpm install
pnpm test:browser:install
```

Playwright is pinned as a development dependency. Browser binaries are installed explicitly so ordinary SDK consumers do not download them.

## Run

Run the Chromium gate while developing:

```bash
pnpm test:browser:chromium
```

Run the complete browser matrix:

```bash
pnpm test:browser
```

Run deterministic and browser suites together:

```bash
pnpm test:all
```

The browser command builds dedicated production-mode fixtures, then Playwright starts:

- Host application: `http://127.0.0.1:4173`
- Cross-origin renderer: `http://127.0.0.1:4174`
- Local Wrangler room service: `http://127.0.0.1:8787`

The worker startup command resets the local Wrangler/D1 state. It never targets remote D1 or performs a deployment.

## Browser projects

The default matrix contains:

- Chromium desktop, with software WebGL enabled for deterministic CI coverage
- Firefox desktop
- WebKit desktop
- Pixel 7 emulation in Chromium

Traces, screenshots, and videos are retained only when a test fails. CI retries failures twice and limits parallel workers to reduce WebGL resource contention.

## Covered behavior

The browser suite currently verifies:

- Cross-origin overlay mounting
- Transparent idle state with no waiting dice
- Mixed physical and fallback-die animation
- Click-to-dismiss without consuming the host application's click
- Overlay destruction and DOM cleanup
- Responsive host integration
- CSP-allowed embedding
- Fail-closed `frame-src` behavior
- Fail-closed `connect-src` behavior
- Two- and three-participant room convergence
- Server-enforced roller-only projections
- Reveal on the same logical roll and revision
- Disconnect and reconnect catch-up from the event cursor

Node-level suites continue to cover malformed payloads, password and capability-token security, revision conflicts, policies, late-event calculations, and persistence orchestration.

## Cross-origin overlay configuration

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: 'https://dice-assets.example.com/overlay.html',
    targetOrigin: 'https://dice-assets.example.com',
    referrerPolicy: 'no-referrer',
    sandbox: ['allow-scripts', 'allow-same-origin'],
  },
});
```

`targetOrigin` should be explicit for remote overlays. The SDK validates both `event.source` and `event.origin` before accepting overlay messages.

The `sandbox` option is optional. A Draftroll renderer needs scripts and its own origin to load modules, textures, fonts, audio, and WebGL resources. Do not add unrelated sandbox capabilities.

## CSP presets

### Embedding application

Replace the example origins with the actual renderer and room-service origins.

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  style-src-attr 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' https://dice.example.com wss://dice.example.com;
  frame-src https://dice-assets.example.com;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-ancestors 'none'
```

The current SDK applies positioning and visibility through DOM styles, so host applications must permit SDK-owned inline styles. Applications that disable the built-in overlay and result panel do not need those style allowances for Draftroll.

### Overlay origin

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  style-src-attr 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  media-src 'self' data: blob:;
  connect-src 'self';
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
  frame-ancestors https://app.example.com
```

Set `frame-ancestors` to the application origins allowed to embed the renderer. Do not use `*` for a hosted production overlay.

## CI recommendations

1. Cache the pnpm store and Playwright browser directory.
2. Run `pnpm test:core` before the browser matrix.
3. Run Chromium as the required pull-request gate.
4. Run Firefox, WebKit, and mobile projects on the main branch or nightly if CI capacity is limited.
5. Upload `playwright-report` and `test-results/browser-artifacts` only on failure.
6. Never substitute a production room service for the local Wrangler process in automated tests.

## Performance project

```bash
pnpm test:browser:performance
# or
pnpm benchmark:renderer
```

The Chromium performance spec checks idle-zero scheduling, battery-profile limits, presentation serialization, a 30-dice WebGL run, and a predetermined 20d20 continuity scenario. The 20d20 case verifies exact values, one committed replay, 120 Hz recording, staged activation, and bounded adjacent-frame displacement. The realtime suite also covers both near-simultaneous coalescing and a later physical roll joining an already-moving spectator table. It attaches diagnostics to the Playwright report. Use controlled hardware and browser settings before treating the output as a baseline.
