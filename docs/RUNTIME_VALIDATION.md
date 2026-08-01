# Runtime validation and compatibility

Draftroll validates data at package boundaries instead of relying on TypeScript types after values cross JSON, WebSocket, HTTP, storage, or application boundaries.

## Versions

```ts
import {
  DRAFTROLL_PROTOCOL_VERSION,
  DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS,
  DRAFTROLL_RESULT_SCHEMA_VERSION,
} from '@draftroll/protocol';
```

The current versions are:

- Realtime room protocol: `2`
- Normalized-result schema: `1`
- Runtime-theme manifest schema: `1`

Room HTTP and WebSocket requests must send `protocolVersion=2`. `DiceRoom` and `authorizeHttpUrl()` add it automatically. An unsupported or missing version receives HTTP `426` with the supported version list.

## Compatibility rules

### Realtime protocol

A room connection negotiates one exact protocol version. Draftroll does not guess how to interpret a newer or older wire protocol.

- Additive changes that do not alter the serialized event contract may remain in the same protocol version.
- New required fields, changed field semantics, removed fields, or changed privacy projections require a new protocol version.
- Realtime decoders reject unknown top-level event fields. This prevents misspelled commands and silently ignored security-sensitive options.
- Clients must not send one protocol version and interpret events as another.

### Normalized results

Every newly generated result contains:

```ts
{
  schemaVersion: 1,
  // ...
}
```

The decoder accepts results created before `schemaVersion` existed and migrates them to version `1`. Explicit unsupported versions are rejected. Migration is intentionally limited: Draftroll does not silently reinterpret a result that declares an incompatible version.

Persisted D1 and Durable Object results are decoded and migrated before use. External application results are decoded before presentation, revision, rerolling, or storage.

### Runtime themes

Theme manifests use their independent `DRAFTROLL_THEME_SCHEMA_VERSION`. Invalid manifests, unsupported versions, oversized resources, failed integrity checks, and unsafe meshes fall back or fail before renderer installation.

## Public decoders

```ts
import {
  decodeClientToServerEvent,
  decodeServerToClientEvent,
  decodeNormalizedRollResult,
  decodeRollInput,
  decodeRollUpdateInput,
  decodeParticipantIdentityInput,
  decodeRoomCapabilityTokenPayload,
  decodeRollVisibility,
  parseRuntimeJson,
} from '@draftroll/protocol';
```

Each decoder returns a discriminated result:

```ts
const decoded = decodeNormalizedRollResult(value);

if (!decoded.success) {
  console.error(decoded.error.issues);
  return;
}

const result = decoded.data;
```

Applications that prefer exceptions can use:

```ts
import {
  assertNormalizedRollResult,
  unwrapDecode,
} from '@draftroll/protocol';

const result = assertNormalizedRollResult(value);
const input = unwrapDecode(decodeRollInput(value));
```

## Diagnostics

Validation failures use `DraftrollValidationError` and structured issues:

```ts
interface RuntimeValidationIssue {
  code:
    | 'invalid_json'
    | 'payload_too_large'
    | 'invalid_type'
    | 'missing_field'
    | 'unknown_field'
    | 'invalid_value'
    | 'invalid_protocol_version'
    | 'unsupported_protocol_version'
    | 'invalid_result_schema_version'
    | 'limit_exceeded';
  path: string;
  message: string;
  expected?: string;
  received?: string;
}
```

Room validation failures are returned as `roll_error` events with `code: "invalid_message"` and the issue array. The browser client emits `DiceRoomProtocolError` instead of dispatching malformed events.

## Default limits

The exported `DEFAULT_RUNTIME_VALIDATION_LIMITS` currently limits:

- JSON payload: 512 KiB generally
- Client WebSocket command: 64 KiB
- Server WebSocket event: 512 KiB
- Expression: 16,384 characters
- Dice per result/input: 1,000
- Operations: 512
- Custom dice definitions: 128
- Faces per custom die: 1,000
- Metadata JSON: 32 KiB
- Metadata nesting: 8 levels
- Metadata keys: 512
- Result-tree nesting: 64 levels

Decoder calls may supply stricter limits:

```ts
const decoded = decodeRollInput(value, {
  limits: {
    maximumDice: 100,
    maximumMetadataBytes: 8 * 1024,
  },
});
```

The Worker always applies its protocol-boundary limits even when a consuming application uses more permissive local limits.

## Privacy invariant

A hidden room event is invalid if it contains a normalized result. The server decoder verifies its own projected events before sending them, and the client decoder verifies them again before dispatching them.

Unauthorized participants receive `result: null` and no animation seed or scheduled animation data.

## Testing

Run:

```bash
pnpm test:validation
```

The suite covers schema migration, unknown fields, invalid nested results, metadata limits, payload limits, protocol negotiation, hidden-result leak rejection, and a deterministic corpus of 500 malformed values.
