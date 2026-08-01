# Character-sheet test client

The root Vite application is a host-integration example. It intentionally looks and behaves like a small character-sheet web application rather than a dice table.

The test page does not load the Three.js engine directly and does not contain a dice canvas. It mounts Draftroll through `Draftroll.createOverlay()`, exactly as another website would.

## Start the local stack

```bash
pnpm install
pnpm worker:setup
pnpm dev:stack
```

Open:

```text
http://127.0.0.1:5173
```

The host page loads the transparent renderer from:

```text
http://127.0.0.1:5173/overlay.html
```

Wrangler runs at `http://127.0.0.1:8787`, with `local-table` as the default room.

## What this test demonstrates

- the character sheet owns all visible application layout and styling
- the SDK owns the transparent WebGL overlay and transient result panel
- there are no idle dice before a roll
- mixed physical dice roll above the sheet in one synchronized simulation
- unsupported dice join the same presentation as synchronized coin, percentile, Fate, spinner, token, or card fallbacks
- the overlay does not block character-sheet controls
- the next click anywhere after completion dissolves the dice
- local and server-authoritative formulas use the same renderer
- named rolls appear in the room log
- whole-roll and individual-die rerolls can be initiated from the log
- formula/name/theme changes can animate or update the log only

## Test a room roll

1. Enter the character and action names.
2. Enter a formula.
3. Connect to the room.
4. Select **Roll in room**.

Useful mixed formulas:

```text
1d20 + 1d4 + 7
1d20 + 1d8 + 2d6 + 5
2d12 + 1d10 + 1d8 + 1d6 + 1d4
1d20 + 1d2 + 1dF + 1d9 + 1d100
```

## Dice dismissal

After a roll settles, click any part of the page. The visible physical dice and transient SDK result panel dissolve. The same click still reaches the underlying character-sheet control.

No dice are created during renderer mount or theme warmup.

## Dice-log actions

Each log entry includes character/action name, formula, authority, revision, total, individual results, and themes. Available actions are:

- reroll the whole logical roll
- reroll one initial die
- load a prior formula into the editor
- update the formula/name/theme and roll again
- update the log without physical replay
- reload persisted room history from D1

## Integration boundary

The relevant host code is in:

```text
src/character-client.ts
src/sdk-demo.ts
src/character-sheet.css
```

The physical renderer remains in the separate overlay entry:

```text
overlay.html
src/overlay.ts
src/main.ts
```

Building the production overlay does not bundle the character-sheet host code.

## Password-protected room testing

The room controls include an optional password field. The value is passed as `roomPassword` during the WebSocket handshake flow and is also used through `authorizeHttpRequest()` when the test client refreshes protected history. It is never added to the room URL.

## Predetermined-result testing

The roller includes an optional **Use predetermined results** mode. Enter one value for every random die result consumed by the formula, in evaluation order:

```text
Formula: 1d20 + 2d6 + 4
Values:  20, 6, 5
```

The playground evaluates the formula locally with those exact random values, preserving modifiers, keep/drop operations, rerolls, explosions, and the calculated total. It then submits the normalized values through `displayRoll()` when connected to a room, or through `Draftroll.display()` for a local preview.

This is intended for testing target-face planning and external authoritative integrations. The normalized result is marked with `authority: "external"` and `metadata.predeterminedResults: true`.

The **Match formula** button fills plausible valid values for the dice terms it detects. Formulas that consume additional random values through rerolls or explosions require those extra values to be entered as well.

## Simultaneous table-roll tester

The open **Simultaneous table-roll tester** section starts the current roll and injects a second named roller after a configurable delay.

Useful delays:

- `0–140 ms`: test one coalesced simultaneous launch.
- `300–600 ms`: test a second handful entering while the first is still moving.
- `1000 ms` or more: test a new throw interacting with recently settled dice.

The first and second formulas can both use predetermined values. When connected, both requests travel through the room server. When offline, both use the local SDK and the same persistent overlay table.

Roll buttons are marked as table-preserving controls, so clicking them does not trigger the normal click-to-dismiss behavior. Other page clicks still dissolve the table. Use **Clear table** to remove it explicitly while testing.
