# Transactional bulk roll updates

Bulk updates apply multiple existing-roll corrections as one room transaction.

```ts
const result = await session.bulkUpdateRolls(
  [
    {
      roll: attack,
      update: { dice: [{ id: attack.dice[0].id, result: 20 }] },
      animate: true,
      audit: { reason: 'Table correction', label: 'GM ruling' },
    },
    {
      roll: damage,
      update: { annotation: 'Resistance applied' },
      animate: false,
    },
  ],
  { signal },
);
```

## Guarantees

- Every target, permission, input, and expected revision is validated before commit.
- The Durable Object performs one multi-key storage transaction for the current roll records.
- Any validation or conflict failure rejects the complete batch.
- Each logical roll still receives its own sequenced `roll_updated` event and D1 revision record.
- The batch receives one `bulk_rolls_updated` acknowledgement.
- Repeated request IDs return the prior acknowledgement rather than applying a second mutation.

The update list is bounded by room policy and runtime payload limits. Do not use bulk updates as an unbounded import mechanism.

## Revision-conflict strategies

Single-roll SDK updates support:

- `reject`: default optimistic-concurrency failure
- `retry-latest`: fetch/use the newest known revision and retry once
- callback merge: application receives the conflict and current roll, then returns a merged update

A transactional batch intentionally rejects on any stale revision; automatically merging only part of a batch would violate atomic application intent.
