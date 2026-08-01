# Errors and cancellation

Draftroll public packages use `@draftroll/errors` for failures that applications may need to classify or recover from. Package-specific errors extend `DraftrollError` and retain their existing fields.

```ts
import {
  DRAFTROLL_ERROR_CODES,
  DraftrollAbortError,
  DraftrollError,
  isAbortError,
  isDraftrollError,
} from '@draftroll/sdk/headless';

try {
  await session.connectRoom({ ...options, signal });
} catch (error) {
  if (isAbortError(error)) return;
  if (isDraftrollError(error) && error.recoverable) {
    console.error(error.code, error.retryAfterMs, error.details);
  }
  throw error;
}
```

## Stable fields

Every `DraftrollError` exposes:

- `code`: stable machine-readable error code
- `package`: `core`, `renderer`, `overlay`, `realtime`, `sdk`, `themes`, `protocol`, or `server`
- `recoverable`: whether retry or user action may recover
- `retryAfterMs`: optional backoff recommendation
- `details`: optional structured context
- `cause`: original failure when available

Do not branch on message text. Treat unknown codes as valid future extensions.

## AbortSignal support

Cancellation is supported for:

- initial room connection and authentication
- clock synchronization
- realtime requests
- renderer warmup and theme loading
- queued and active presentation waits
- preview and dismissal work
- overlay loading and commands

Aborting rejects with `DraftrollAbortError` and code `operation_aborted`. Cancellation never changes an authoritative roll result. A request that has already reached the room may still complete server-side; use idempotent request IDs and read the current room state before retrying an ambiguous network operation.

## Observer isolation

Lifecycle, room, renderer, and SDK event listeners are isolated. An exception thrown by one listener cannot interrupt request correlation, state transitions, persistence, or another listener. Applications should still capture listener failures through their own error reporting.
