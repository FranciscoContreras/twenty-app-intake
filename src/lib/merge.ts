/**
 * What an update does to a field that already holds a value.
 *
 * Before 0.4.0 every update was a blind PATCH: whatever arrived overwrote
 * whatever was there. That is fine the first time a lead is seen and lossy every
 * time after. A returning enquiry with the name box left blank would replace a
 * salesperson's corrected spelling with nothing, and there is no undo in a CRM
 * for a field that was quietly overwritten by a webhook at 3am.
 *
 * PRESERVE is therefore the default: fill what is empty, leave what is written.
 * NEWEST_WINS is the old behaviour, kept for anyone who relied on it.
 *
 * The decision is per field, so a rule can mark a genuinely volatile attribute
 * — a lead score, a last-seen page — NEWEST_WINS while names and emails stay
 * protected by the workspace default.
 */

import type { MergePolicy } from './settings';

export type FieldMergeStrategy = 'INHERIT' | 'PRESERVE' | 'NEWEST_WINS';

export type MergeDecision = {
  /** Whether the incoming value is written. */
  write: boolean;
  /** Why, for the dry-run diff and the log's warnings. */
  status: 'set' | 'filled-empty' | 'preserved' | 'unchanged';
};

/**
 * Decide whether `incoming` replaces `existing`.
 *
 * `existing` is the value already on the record — undefined when the record is
 * new or has never held this field.
 */
export function decideMerge(
  existing: unknown,
  incoming: unknown,
  policy: MergePolicy,
  strategy: FieldMergeStrategy = 'INHERIT',
): MergeDecision {
  // Never write a blank over anything. An absent value in a payload means the
  // sender had nothing to say about that field, not that it should be cleared.
  if (isEmpty(incoming)) return { write: false, status: 'preserved' };

  if (isEmpty(existing)) return { write: true, status: 'filled-empty' };

  if (sameValue(existing, incoming)) return { write: false, status: 'unchanged' };

  const effective = strategy === 'INHERIT' ? policy : strategy;
  return effective === 'NEWEST_WINS'
    ? { write: true, status: 'set' }
    : { write: false, status: 'preserved' };
}

/**
 * Apply the policy across a whole patch.
 *
 * Returns only the keys that should actually be sent, plus a per-field record of
 * what was decided so the caller can report it.
 */
export function mergePatch(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  policy: MergePolicy,
  strategyFor: (field: string) => FieldMergeStrategy = () => 'INHERIT',
): {
  patch: Record<string, unknown>;
  decisions: Record<string, MergeDecision>;
} {
  const patch: Record<string, unknown> = {};
  const decisions: Record<string, MergeDecision> = {};

  for (const [key, value] of Object.entries(incoming)) {
    const decision = decideMerge(existing[key], value, policy, strategyFor(key));
    decisions[key] = decision;
    if (decision.write) patch[key] = value;
  }

  return { patch, decisions };
}

export function parseFieldMergeStrategy(raw: string | null | undefined): FieldMergeStrategy {
  switch ((raw ?? '').toUpperCase()) {
    case 'PRESERVE': return 'PRESERVE';
    case 'NEWEST_WINS': return 'NEWEST_WINS';
    default: return 'INHERIT';
  }
}

/**
 * Emptiness has to understand Twenty's composite shapes, not just `null`.
 *
 * A person whose name has never been set comes back as
 * `{ firstName: '', lastName: '' }`, and an unset phone as an object of empty
 * strings. Treating those as "already has a value" is what would make PRESERVE
 * refuse to ever populate a record, so the check recurses into objects and
 * calls one empty when every leaf inside it is.
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return true;
    // Ignore the metadata Twenty attaches to composites — a currency code alone
    // does not mean an amount was entered.
    const meaningful = entries.filter(([k]) => !IGNORED_COMPOSITE_KEYS.has(k));
    if (meaningful.length === 0) return true;
    return meaningful.every(([, v]) => isEmpty(v));
  }
  return false;
}

const IGNORED_COMPOSITE_KEYS = new Set([
  'currencyCode',
  'primaryLinkLabel',
  'primaryPhoneCountryCode',
  'primaryPhoneCallingCode',
  'additionalLinks',
  'additionalEmails',
  'additionalPhones',
]);

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    try {
      return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
  return out;
}
