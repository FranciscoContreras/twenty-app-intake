/**
 * What gets kept of an inbound payload, and for how much of it.
 *
 * The stored copy is what makes replay possible: a field mapping added a week
 * late can be applied to everything already received instead of being lost. That
 * value only exists if the copy is faithful, so retention is FULL by default and
 * the payload is stored as sent.
 *
 * Two things are nonetheless never stored. Credentials are stripped
 * unconditionally — an audit log is the last place a password or API token
 * should come to rest, and no replay needs one. And the copy is capped, because
 * an IntakeLog row is not the right home for a multi-megabyte upload.
 *
 * What remains is still personal data: names, emails, phone numbers and whatever
 * else a sender chose to put in the body. It lives in the IntakeLog object under
 * the workspace's own access control, and it is visible to anyone who can read
 * that object. Workspaces that would rather not hold a second copy can set
 * INTAKE_RAW_PAYLOAD_RETENTION=NONE, which switches replay and retry off.
 */

import { rawPayloadMaxBytes, rawPayloadRetention } from './settings';

/**
 * Keys whose values are secrets. Matched on the normalised key, as a substring,
 * so `stripe_secret_key` and `apiToken` are both caught. Deliberately broad: a
 * false positive costs one redacted field in an audit record, a false negative
 * writes a live credential into a database.
 */
const CREDENTIAL_KEY_PATTERNS = [
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'authorization', 'auth', 'credential', 'privatekey', 'private_key',
  'session', 'cookie', 'ssn', 'socialsecurity', 'creditcard', 'credit_card',
  'cardnumber', 'card_number', 'cvv', 'cvc', 'pin', 'accesskey', 'access_key',
];

export const REDACTED = '[redacted]';

function isCredentialKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[-\s]/g, '_');
  return CREDENTIAL_KEY_PATTERNS.some((p) => norm.includes(p));
}

/**
 * Replace credential values with a marker, recursively, leaving structure and
 * every other value intact so the result still replays.
 */
export function redactCredentials(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactCredentials(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isCredentialKey(key) ? REDACTED : redactCredentials(v, depth + 1);
  }
  return out;
}

export type RetainedPayload = {
  /** JSON to store, or null when retention is off or the payload is too large. */
  stored: string | null;
  /** A warning for the log when something was not kept, otherwise null. */
  warning: string | null;
};

/**
 * Prepare a payload for storage on an IntakeLog.
 *
 * An oversized payload is dropped rather than truncated. A half-stored JSON
 * document cannot be parsed and so cannot be replayed; keeping it would only
 * offer a replay that fails later, which is worse than saying so now.
 */
export function prepareForStorage(payload: Record<string, unknown>): RetainedPayload {
  if (rawPayloadRetention() === 'NONE') {
    return { stored: null, warning: null };
  }

  let json: string;
  try {
    json = JSON.stringify(redactCredentials(payload));
  } catch {
    return { stored: null, warning: 'Payload could not be serialised — not stored, so replay is unavailable for this log' };
  }

  const max = rawPayloadMaxBytes();
  if (Buffer.byteLength(json, 'utf8') > max) {
    return {
      stored: null,
      warning: `Payload exceeds INTAKE_RAW_PAYLOAD_MAX_BYTES (${max}) — not stored, so replay is unavailable for this log`,
    };
  }

  return { stored: json, warning: null };
}
