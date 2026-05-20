import { createHash } from 'node:crypto';

/**
 * Compute a stable SHA-256 hash of a payload.
 * Keys are sorted before hashing so that { a:1, b:2 } and { b:2, a:1 }
 * produce the same hash — safe to retry from any client.
 */
export function computePayloadHash(payload: unknown): string {
  const stable = stableStringify(payload);
  return createHash('sha256').update(stable).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return '{' + sorted + '}';
}

/** Derive a human-readable idempotency window label. */
export function withinWindow(processedAt: Date, windowMs = 5 * 60 * 1000): boolean {
  return Date.now() - processedAt.getTime() < windowMs;
}
