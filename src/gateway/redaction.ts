export function redact(s: unknown): string {
  return String(s)
    .replace(/github_pat_[A-Za-z0-9_]{15,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
}
