# Playground table and exact-result testing

The root character-sheet playground includes controls intended for visual and integration testing. They are not required by ordinary SDK consumers.

## Exact face targets

1. Enter a formula such as `1d20+2d6+4`.
2. Enable **Use predetermined results**.
3. Enter `20, 6, 5` in **Values in roll order**.
4. Choose **Local preview** or connect and choose **Roll in room**.

The formula is evaluated using the supplied values as its random sequence. Flat modifiers and expression operations still determine the final total. Connected tests use `DiceRoom.displayRoll()` so the exact normalized result crosses the server and is rendered by every authorized participant.

The result metadata contains:

```ts
{
  predeterminedResults: true,
  requestedResults: [20, 6, 5],
}
```

## Two-roller scenario

The **Simultaneous table-roll tester** starts the main roller and a second named roller with a configurable delay. Its default is 80 ms so both handfuls are planned together as fully dynamic bodies.

|            Delay | Scenario                                                   |
| ---------------: | ---------------------------------------------------------- |
|         0–140 ms | One fully dynamic shared-world launch                      |
|       300–600 ms | Incoming dice collide with the preserved moving trajectory |
| 1,000 ms or more | Incoming dice can strike and move recently settled dice    |

The second fixed-result field is optional. Clear it to use normal random server or local evaluation.

## Persistent table controls

The playground passes concurrent table options on ordinary local and room starts. Completed compatible physical dice remain available for the next throw until the table is dismissed.

Roll buttons use:

```html
<button data-draftroll-preserve-table>Roll</button>
```

and the overlay is configured with:

```ts
dismissIgnoreSelector: '[data-draftroll-preserve-table]';
```

This prevents the pointer gesture that initiates an asynchronous room roll from dissolving settled dice before the server event returns. Clicking elsewhere still dismisses the table. **Clear table** removes it immediately.
