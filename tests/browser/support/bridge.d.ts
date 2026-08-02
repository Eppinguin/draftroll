// Pulls in the `declare global` block from `src/main.ts`, which types the overlay
// `draftrollDice` bridge that the built overlay page installs on `window`. Specs reference
// this file so they can read `window.draftrollDice` directly instead of asserting
// `window as unknown as { draftrollDice: ... }` at every call site.
//
// The import is what loads the global declarations; `DicePerformanceSnapshot` is re-exported
// so this is a normal named `import`/`export` rather than an empty specifier or a triple-slash
// reference, both of which the lint rules reject. `import type` keeps it erased at runtime, so
// referencing this file never pulls the app into a spec bundle.
import type { DicePerformanceSnapshot } from '../../../src/main';

export type { DicePerformanceSnapshot };
