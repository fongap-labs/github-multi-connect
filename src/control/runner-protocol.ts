export const RUNNER_PROTOCOL_VERSION = 'v1' as const;
export const RUNNER_HEARTBEAT_TTL_MS = 60_000;
export const RUNNER_MAX_CAPABILITIES = 64;
export const RUNNER_MAX_CONCURRENCY = 128;

export type RunnerAvailability = 'available' | 'busy' | 'unavailable' | 'unknown';
export type RunnerScope = 'runner:register' | 'runner:heartbeat';

/** Created by the trusted authentication adapter; never parsed from a Runner payload. */
export interface AuthenticatedRunner {
  readonly runnerId: string;
  readonly credentialId: string;
  readonly scopes: readonly RunnerScope[];
}

/** Registration contains claims only. The Hub binds it to the authenticated Runner identity. */
export interface RunnerRegistrationRequest {
  readonly protocolVersion: typeof RUNNER_PROTOCOL_VERSION;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly maxConcurrency: number;
}

/** Heartbeats report liveness and concurrency, never task completion or side effects. */
export interface RunnerHeartbeatRequest {
  readonly protocolVersion: typeof RUNNER_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly activeConcurrency: number;
}

/** Hub-produced capacity snapshot. Runner identity and timestamps are Hub-owned. */
export interface RunnerCapacity {
  readonly protocolVersion: typeof RUNNER_PROTOCOL_VERSION;
  readonly runnerId: string;
  readonly capabilities: readonly string[];
  readonly maxConcurrency: number;
  readonly activeConcurrency: number;
  readonly availability: RunnerAvailability;
  readonly observedAt: string | null;
  readonly expiresAt: string | null;
}

export type RunnerProtocolErrorCode =
  | 'invalid_payload_shape'
  | 'unsupported_protocol_version'
  | 'invalid_display_name'
  | 'invalid_capability'
  | 'invalid_capacity'
  | 'invalid_heartbeat_sequence'
  | 'stale_heartbeat';

export class RunnerProtocolError extends Error {
  readonly code: RunnerProtocolErrorCode;

  constructor(code: RunnerProtocolErrorCode) {
    super(code);
    this.name = 'RunnerProtocolError';
    this.code = code;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RunnerProtocolError('invalid_payload_shape');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RunnerProtocolError('invalid_payload_shape');
  }
}

function protocolVersion(value: unknown): void {
  if (value !== RUNNER_PROTOCOL_VERSION) throw new RunnerProtocolError('unsupported_protocol_version');
}

export function parseRunnerRegistration(value: unknown): RunnerRegistrationRequest {
  const input = objectValue(value);
  exactKeys(input, ['protocolVersion', 'displayName', 'capabilities', 'maxConcurrency']);
  protocolVersion(input.protocolVersion);

  if (typeof input.displayName !== 'string' || input.displayName.length < 1 || input.displayName.length > 80 ||
      input.displayName.trim() !== input.displayName || /[\u0000-\u001f\u007f]/.test(input.displayName)) {
    throw new RunnerProtocolError('invalid_display_name');
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length < 1 || input.capabilities.length > RUNNER_MAX_CAPABILITIES ||
      input.capabilities.some(capability => typeof capability !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(capability)) ||
      new Set(input.capabilities).size !== input.capabilities.length) {
    throw new RunnerProtocolError('invalid_capability');
  }
  if (!Number.isSafeInteger(input.maxConcurrency) || (input.maxConcurrency as number) < 1 || (input.maxConcurrency as number) > RUNNER_MAX_CONCURRENCY) {
    throw new RunnerProtocolError('invalid_capacity');
  }

  return Object.freeze({
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    displayName: input.displayName,
    capabilities: Object.freeze([...input.capabilities as string[]].sort()),
    maxConcurrency: input.maxConcurrency as number,
  });
}

export function parseRunnerHeartbeat(value: unknown, maxConcurrency: number, lastSequence: number | null): RunnerHeartbeatRequest {
  const input = objectValue(value);
  exactKeys(input, ['protocolVersion', 'sequence', 'activeConcurrency']);
  protocolVersion(input.protocolVersion);

  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > RUNNER_MAX_CONCURRENCY ||
      !Number.isSafeInteger(input.activeConcurrency) || (input.activeConcurrency as number) < 0 || (input.activeConcurrency as number) > maxConcurrency) {
    throw new RunnerProtocolError('invalid_capacity');
  }
  if (!Number.isSafeInteger(input.sequence) || (input.sequence as number) < 1) {
    throw new RunnerProtocolError('invalid_heartbeat_sequence');
  }
  if (lastSequence !== null && (!Number.isSafeInteger(lastSequence) || (input.sequence as number) <= lastSequence)) {
    throw new RunnerProtocolError('stale_heartbeat');
  }

  return Object.freeze({
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    sequence: input.sequence as number,
    activeConcurrency: input.activeConcurrency as number,
  });
}

export function resolveRunnerAvailability(input: {
  enabled: boolean;
  observedAt: number | null;
  expiresAt: number | null;
  activeConcurrency: number | null;
  maxConcurrency: number;
  now: number;
}): RunnerAvailability {
  if (!input.enabled) return 'unavailable';
  if (input.observedAt === null || input.expiresAt === null || input.activeConcurrency === null ||
      !Number.isFinite(input.observedAt) || !Number.isFinite(input.expiresAt) || !Number.isFinite(input.now) ||
      input.expiresAt <= input.observedAt || input.now < input.observedAt || input.now >= input.expiresAt ||
      !Number.isSafeInteger(input.maxConcurrency) || input.maxConcurrency < 1 ||
      !Number.isSafeInteger(input.activeConcurrency) || input.activeConcurrency < 0 || input.activeConcurrency > input.maxConcurrency) {
    return 'unknown';
  }
  return input.activeConcurrency >= input.maxConcurrency ? 'busy' : 'available';
}

/** Builds a snapshot with Hub time; callers must pass the identity from authenticated server state. */
export function createRunnerCapacity(input: {
  runnerId: string;
  registration: RunnerRegistrationRequest;
  heartbeat: RunnerHeartbeatRequest;
  receivedAt: Date;
  enabled?: boolean;
}): RunnerCapacity {
  const receivedAt = input.receivedAt.getTime();
  if (!input.runnerId || input.runnerId.length > 128 || input.runnerId.trim() !== input.runnerId || !Number.isFinite(receivedAt) ||
      input.heartbeat.activeConcurrency < 0 || input.heartbeat.activeConcurrency > input.registration.maxConcurrency) {
    throw new RunnerProtocolError('invalid_capacity');
  }
  const expiresAt = receivedAt + RUNNER_HEARTBEAT_TTL_MS;
  return Object.freeze({
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runnerId: input.runnerId,
    capabilities: input.registration.capabilities,
    maxConcurrency: input.registration.maxConcurrency,
    activeConcurrency: input.heartbeat.activeConcurrency,
    availability: resolveRunnerAvailability({
      enabled: input.enabled !== false,
      observedAt: receivedAt,
      expiresAt,
      activeConcurrency: input.heartbeat.activeConcurrency,
      maxConcurrency: input.registration.maxConcurrency,
      now: receivedAt,
    }),
    observedAt: new Date(receivedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
}
