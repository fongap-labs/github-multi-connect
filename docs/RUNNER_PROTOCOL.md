# Runner Protocol v1

This document defines the data contract for Runner registration, heartbeats, the authenticated Registry, and bounded resource leases. Dispatch and quota reporting build on these identities and leases in [Runner Dispatch Protocol v1](RUNNER_DISPATCH.md).

## Identity and authentication

- A trusted Hub authenticator produces `AuthenticatedRunner` with a Hub-issued `runnerId`, a credential identifier, and the permitted protocol scopes.
- Registration and heartbeat payloads do not accept `runnerId`, credentials, workspace paths, or task status. The Hub binds reports to the identity supplied by the authenticator.
- A Runner can report capacity and capabilities, but cannot authorize itself, expand its scopes, or select another Runner identity.
- An administrator provisions the Runner in `/admin`; the Hub generates its identity and a one-time bearer credential. D1 stores only the SHA-256 credential hash. The credential is returned once and must be stored by the Runner operator.
- `POST /runner/register` and `POST /runner/heartbeat` require that bearer credential. The Hub resolves identity from the credential and never reads an identity from the request body. Disabling a Runner revokes its credential immediately.
- Provisioning sets the allowed capability list and maximum concurrency. A registration may narrow these limits, but cannot expand either one.

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

Heartbeat concurrency is a Runner report, not task execution authority. It does not say which task is running, whether side effects occurred, or whether work completed. The lease store is the source of Hub-owned resource claims; Runtime remains authoritative for execution state.

## Capacity and failure semantics

The Hub produces a `RunnerCapacity` snapshot containing the Hub-issued identity, registered capabilities and maximum concurrency, the latest accepted report, and Hub-generated `observedAt` and `expiresAt` timestamps. The current heartbeat lifetime is 60 seconds. Before the first accepted heartbeat, those timestamps are null and availability is `unknown`.

- `available`: a fresh heartbeat reports less than maximum concurrency.
- `busy`: a fresh heartbeat reports maximum concurrency.
- `unknown`: no heartbeat has arrived, or its expiry has passed. Network loss alone does not prove that the Runner is stopped.
- `unavailable`: the Hub has disabled or revoked that Runner.

Unknown and unavailable Runners are ineligible for new dispatch. A lost heartbeat does not authorize task replay or migration. Recovery policy must check Runtime records and side-effect certainty before moving work.

## Leases

The Registry exposes the Hub-owned lease store used by the dispatch contract. A lease represents a finite capacity claim only. It is not a Runtime task record and carries no task state or completion result.

- Lease TTL is bounded to 60–900 seconds. Acquisition is a single conditional insert that checks the Runner is enabled, registered, heartbeat-fresh, and below its concurrency limit.
- The idempotency key is unique and retained after release or expiry. Retrying a still-live key with the same Runner and resource returns the existing lease. A changed request, released lease, or expired lease conflicts; the key cannot be recycled.
- Renewals require the lease and Runner to remain live. Release is idempotent. Expired leases no longer occupy capacity and are retained as idempotency tombstones.
- Disabling a Runner revokes credentials and releases its live Hub leases. Losing a heartbeat does not cause task retry or reassignment.

## Error contract

The pure validators in `src/control/runner-protocol.ts` fail with stable codes: `invalid_payload_shape`, `unsupported_protocol_version`, `invalid_display_name`, `invalid_capability`, `invalid_capacity`, `invalid_heartbeat_sequence`, or `stale_heartbeat`. The HTTP endpoints map these codes to protocol error responses without returning credentials or internal exception details.

## Dispatch contract

The resource selection, quota, queue, offer handshake, cancellation and Runtime reconciliation rules are defined in [Runner Dispatch Protocol v1](RUNNER_DISPATCH.md). Runtime remains authoritative for execution state and uncertain side effects.
