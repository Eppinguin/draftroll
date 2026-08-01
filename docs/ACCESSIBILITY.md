# Accessibility and constrained rendering

Draftroll supports a non-WebGL path and reduced-motion presentation. Applications should expose normalized results in their own semantic UI even when using 3D dice.

## Text renderer

```ts
import { DraftrollTextRenderer } from '@draftroll/renderer';

const renderer = new DraftrollTextRenderer({
  container: document.querySelector('#dice-results')!,
  label: 'Dice results',
  persistent: true,
  maximumEntries: 20,
});
```

The renderer creates a polite `role="status"` live region, includes the total and per-die labels, supports participant filtering, and works without WebGL. It can also run headlessly through the `present` callback.

## Reduced motion

Pass `reducedMotion: true` to a presentation or configure it from room renderer policy. Physical renderers settle directly or use concise fallback motion. Hosts should also observe `prefers-reduced-motion` and select `DraftrollTextRenderer` when motion is unnecessary.

## Overlay behavior

The iframe is keyboard-inert (`tabindex="-1"`) and `aria-hidden`; the host-side result panel owns announcements. Escape dismisses the active presentation. Normal overlay pointer passthrough remains intact so unrelated host controls continue to work.

## Responsive and mobile behavior

The physical bridge measures its actual CSS viewport, backing buffer, and camera aspect ratio together. It applies per-die containment, pixel-ratio caps, dynamic resolution, count-aware frame budgets, and small-container bounds. Mobile emulation is included in the Playwright project matrix.

## Required host checks

- Keep a visible or screen-reader-accessible result history outside the canvas.
- Do not use color, particle effects, or sound as the only indication of success/failure.
- Preserve a keyboard path to the control that initiates a roll.
- Announce visibility changes without revealing hidden values.
- Test zoom, high contrast, reduced motion, touch, and keyboard dismissal in the consuming application.
