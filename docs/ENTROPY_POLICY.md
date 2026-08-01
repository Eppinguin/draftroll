# Entropy and audit policy

Draftroll uses environment-provided cryptographic randomness for normal local/server rolls and supports injected deterministic RNG for tests, replays, and application-controlled authoritative results.

## Default trust model

- Local rolls trust the user's runtime.
- Room rolls trust the deployed Worker and its evaluation core.
- Animation seeds are presentation data and are not evidence of random fairness.
- Normalized result history and audit labels establish what was accepted, revised, or revealed; they do not prove how a random value was generated outside Draftroll.

## Independently auditable deployments

A deployment requiring external audit should implement an application-owned entropy protocol, such as commit-reveal or a verifiable-randomness provider, and submit the resulting exact values through Draftroll's external/structured authoritative-result APIs. Store only non-secret commitments, provider proofs, algorithm/version identifiers, and verification outcomes in bounded metadata.

Do not expose unrevealed seeds, capability secrets, room passwords, or private-provider credentials. Define failure behavior before deployment: reject, fall back to trusted Worker entropy, or require operator intervention.

## Deterministic testing

Seeded RNG and replay seeds are for reproducibility. They must never be described as cryptographically unpredictable. Tests should assert exact sequences; production code should use the default secure RNG unless an independently audited source provides exact results.
