# Runner Protocol v1

This document defines the data contract for Runner registration and heartbeats. It does not add public Runner endpoints, persistence, task dispatch, leases, or a scheduler. Those belong in later work after the contract is reviewed.

## Identity and authentication

- A trusted Hub authenticator produces `AuthenticatedRunner` with a Hub-issued `runnerId`, a credential identifier, and the permitted protocol scopes.
- Registration and heartbeat payloads do not accept `runnerId`, credentials, workspace paths, or task status. The Hub binds reports to the identity supplied by the authenticator.
- A Runner can report capacity and capabilities, but cannot authorize itself, expand its scopes, or select another Runner identity.
- The HTTP proof mechanism, enrollment flow, key rotation, and credential storage are implementation work for the Runner Registry. Until that work exists, this contract does not claim that Runner authentication is deployed.

## Registration

The v1 registration object has exactly these fields:

```json
{
  "protocolVersion": "v1",
  "displayName": "Codex local",
  "capabilities": ["coding.patch", "coding.test"],
  "maxConcurrency": 2
}
```

The Hub accepts 1–64 distinct lowercase capability names matching `[a-z][a-z0-9._-]{0,63}`. It accepts `maxConcurrency` from 1 to 128. Capabilities and maximum concurrency are Runner claims; the Hub must apply its own limits and policy before using them for dispatch. The Hub sorts capabilities before storing them. Unknown fields are rejected so a caller cannot smuggle identity or execution state into this contract.

## Heartbeat

The v1 heartbeat object also has an exact shape:

```json
{
  "protocolVersion": "v1",
  "sequence": 42,
  "activeConcurrency": 1
}
```

Sequences start at 1 and must strictly increase for the authenticated Runner. The Hub rejects duplicate or older sequence values. The Registry must persist the high-water mark atomically so concurrent heartbeat requests cannot both be accepted with the same sequence. `activeConcurrency` must be between zero and the registered maximum. The Hub records receive time; Runner clocks do not determine freshness.

Heartbeat concurrency is a Runner report, not task execution authority. It does not say which task is running, whether side effects occurred, or whether work completed. A future Lease Store remains the source of Hub-owned resource claims; Runtime remains authoritative for execution state.

## Capacity and failure semantics

The Hub produces a `RunnerCapacity` snapshot containing the Hub-issued identity, registered capabilities and maximum concurrency, the latest accepted report, and Hub-generated `observedAt` and `expiresAt` timestamps. The current heartbeat lifetime is 60 seconds.

- `available`: a fresh heartbeat reports less than maximum concurrency.
- `busy`: a fresh heartbeat reports maximum concurrency.
- `unknown`: no heartbeat has arrived, or its expiry has passed. Network loss alone does not prove that the Runner is stopped.
- `unavailable`: the Hub has disabled or revoked that Runner.

Unknown and unavailable Runners are ineligible for new dispatch. A lost heartbeat does not authorize task replay or migration. Recovery policy must check Runtime records and side-effect certainty before moving work.

## Error contract

The pure validators in `src/control/runner-protocol.ts` fail with stable codes: `invalid_payload_shape`, `unsupported_protocol_version`, `invalid_display_name`, `invalid_capability`, `invalid_capacity`, `invalid_heartbeat_sequence`, or `stale_heartbeat`. A future HTTP adapter maps these codes to protocol error responses without returning credentials or internal exception details.

## What this contract leaves for later PRs

The next implementation work can add authenticated registration, persistence, heartbeat expiry, and bounded leases. It must keep Runner identity Hub-owned, keep leases separate from Runtime task state, and avoid retrying work whose side effects are uncertain. Global dispatch and automatic recovery remain out of scope here.
