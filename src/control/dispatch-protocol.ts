export const DISPATCH_PROTOCOL_VERSION = 'v1' as const;
export const DISPATCH_OFFER_TTL_SECONDS = 60;
export const DISPATCH_OUTBOX_RETRY_SECONDS = 60;
export const QUOTA_REPORT_TTL_SECONDS = 300;

export interface ResourceDispatchRequest {
  protocolVersion: typeof DISPATCH_PROTOCOL_VERSION;
  idempotencyKey: string;
  taskRef: string;
  resourceKey: string;
  requiredCapabilities: string[];
  priority: number;
  quotaKey: string | null;
  leaseSeconds: number;
}

export interface RunnerQuotaReport {
  protocolVersion: typeof DISPATCH_PROTOCOL_VERSION;
  quotaKey: string;
  sequence: number;
  remaining: number;
  limit: number;
  cooldownSeconds: number;
}

export type RuntimeDispatchState = 'not_started' | 'running' | 'side_effects_uncertain' | 'completed' | 'cancelled' | 'failed';

export class DispatchProtocolError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'DispatchProtocolError'; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DispatchProtocolError('invalid_payload_shape');
  return value as Record<string, unknown>;
}
function exact(input: Record<string, unknown>, keys: readonly string[]) {
  const actual=Object.keys(input).sort(), expected=[...keys].sort();
  if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw new DispatchProtocolError('invalid_payload_shape');
}
function capabilityList(value: unknown): value is string[] {
  return Array.isArray(value)&&value.length>=1&&value.length<=64&&
    value.every(item=>typeof item==='string'&&/^[a-z][a-z0-9._-]{0,63}$/.test(item))&&new Set(value).size===value.length;
}
function protocol(value: unknown) { if(value!==DISPATCH_PROTOCOL_VERSION)throw new DispatchProtocolError('unsupported_protocol_version'); }

export function parseResourceDispatch(value: unknown): ResourceDispatchRequest {
  const input=object(value);
  const allowed=['protocolVersion','idempotencyKey','taskRef','resourceKey','requiredCapabilities','priority','quotaKey','leaseSeconds'];
  if(Object.keys(input).some(key=>!allowed.includes(key))||allowed.filter(key=>key!=='quotaKey'&&key!=='leaseSeconds').some(key=>!(key in input)))
    throw new DispatchProtocolError('invalid_payload_shape');
  protocol(input.protocolVersion);
  if(typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)||
      typeof input.taskRef!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(input.taskRef)||
      typeof input.resourceKey!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(input.resourceKey))
    throw new DispatchProtocolError('invalid_reference');
  if(!capabilityList(input.requiredCapabilities))throw new DispatchProtocolError('invalid_capability');
  if(!Number.isSafeInteger(input.priority)||(input.priority as number)<0||(input.priority as number)>100)
    throw new DispatchProtocolError('invalid_priority');
  const quotaKey=input.quotaKey===undefined||input.quotaKey===null?null:input.quotaKey;
  if(quotaKey!==null&&(typeof quotaKey!=='string'||!/^[a-z][a-z0-9._:-]{0,63}$/.test(quotaKey)))
    throw new DispatchProtocolError('invalid_quota_key');
  const leaseSeconds=input.leaseSeconds===undefined?300:input.leaseSeconds;
  if(!Number.isSafeInteger(leaseSeconds)||(leaseSeconds as number)<60||(leaseSeconds as number)>900)
    throw new DispatchProtocolError('invalid_lease');
  return Object.freeze({protocolVersion:DISPATCH_PROTOCOL_VERSION,idempotencyKey:input.idempotencyKey,taskRef:input.taskRef,
    resourceKey:input.resourceKey,requiredCapabilities:[...input.requiredCapabilities].sort(),priority:input.priority as number,
    quotaKey:quotaKey as string|null,leaseSeconds:leaseSeconds as number});
}

export function parseQuotaReport(value: unknown): RunnerQuotaReport {
  const input=object(value);exact(input,['protocolVersion','quotaKey','sequence','remaining','limit','cooldownSeconds']);protocol(input.protocolVersion);
  if(typeof input.quotaKey!=='string'||!/^[a-z][a-z0-9._:-]{0,63}$/.test(input.quotaKey))throw new DispatchProtocolError('invalid_quota_key');
  if(!Number.isSafeInteger(input.sequence)||(input.sequence as number)<1)throw new DispatchProtocolError('invalid_quota_sequence');
  if(!Number.isSafeInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>1000000||
      !Number.isSafeInteger(input.remaining)||(input.remaining as number)<0||(input.remaining as number)>(input.limit as number))
    throw new DispatchProtocolError('invalid_quota');
  if(!Number.isSafeInteger(input.cooldownSeconds)||(input.cooldownSeconds as number)<0||(input.cooldownSeconds as number)>86400)
    throw new DispatchProtocolError('invalid_cooldown');
  return Object.freeze({protocolVersion:DISPATCH_PROTOCOL_VERSION,quotaKey:input.quotaKey,sequence:input.sequence as number,
    remaining:input.remaining as number,limit:input.limit as number,cooldownSeconds:input.cooldownSeconds as number});
}

export function parseRuntimeReconciliation(value: unknown): {dispatchId:string;sequence:number;state:RuntimeDispatchState} {
  const input=object(value);exact(input,['dispatchId','sequence','state']);
  if(typeof input.dispatchId!=='string'||!/^dispatch_[A-Za-z0-9_-]{43}$/.test(input.dispatchId))throw new DispatchProtocolError('invalid_dispatch_id');
  if(!Number.isSafeInteger(input.sequence)||(input.sequence as number)<1)throw new DispatchProtocolError('invalid_runtime_sequence');
  if(!['not_started','running','side_effects_uncertain','completed','cancelled','failed'].includes(String(input.state)))
    throw new DispatchProtocolError('invalid_runtime_state');
  return {dispatchId:input.dispatchId,sequence:input.sequence as number,state:input.state as RuntimeDispatchState};
}
