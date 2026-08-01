# Incident response

## Severity

- **SEV-1:** hidden result disclosure, signing-key compromise, unauthorized room management, or destructive persistence corruption
- **SEV-2:** widespread room unavailability, sustained persistence failures, protocol incompatibility, or reconnect storms
- **SEV-3:** localized performance degradation, isolated room failure, or non-sensitive presentation regression

## Immediate actions

1. Preserve timestamps, deployment version, environment, request IDs, room IDs, and sanitized logs.
2. For privacy or credential incidents, disable affected rooms with policy shutdown and rotate/revoke credentials immediately.
3. For broad regressions, stop promotion and execute the rollback procedure.
4. Do not copy hidden result payloads, room passwords, bearer tokens, or key material into tickets/chat.
5. Run `/health`; for authorized operators, collect `/diagnostics` and D1 migration/deployment state.

## Credential compromise

1. Add a new signing key and start issuing with its new key ID.
2. Revoke compromised exact token IDs or participant tokens issued before a cutoff.
3. Remove the compromised verification key only after revocation/expiry coverage is established.
4. Review issuer/audience/origin settings and access logs.
5. Notify affected hosts with precise scope and remediation.

## Privacy incident

A public value already delivered to a client cannot be retroactively erased by changing visibility. Containment prevents future projections/history reads but does not retract prior data. Treat accidental public delivery as disclosure and follow the consuming application's incident policy.

## Recovery validation

After remediation:

- run deployment smoke tests
- verify anonymous access remains disabled
- verify allowed and denied origins
- verify hidden projections contain no result-bearing fields
- verify D1 writes and long-range recovery
- verify token revocation and key-ID behavior
- monitor error/reconnect/persistence rates through at least one normal traffic cycle
