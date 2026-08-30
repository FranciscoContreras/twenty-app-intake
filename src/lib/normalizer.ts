import { FIELD_MAP, normaliseKey, type FieldAction, type TwentyFieldType } from '../constants/field-map';
import { detectType } from './type-detector';
import { classify } from './classifier';
import { parseFieldMergeStrategy, type FieldMergeStrategy } from './merge';

/**
 * Which record a field is written to.
 *
 * `auto` defers to the shape of the payload — the primary record, which is the
 * person when there is person data and the company otherwise. `opportunity` is
 * never chosen by inference: a field lands on the deal only when a rule says so
 * or the incoming key carries an explicit opportunity prefix, because guessing
 * that `budget` is a deal attribute rather than a contact attribute is exactly
 * the kind of surprise that makes an ingestion layer untrustworthy.
 */
export type TargetObject = 'auto' | 'person' | 'company' | 'opportunity';

export type NormalizedField = {
  originalKey: string;
  canonicalName: string;
  twentyType: TwentyFieldType;
  action: FieldAction;
  value: unknown;
  source: 'builtin' | 'rule' | 'passthrough';
  targetObject: TargetObject;
  /**
   * Set by SyncSchemaStage once it knows what the workspace actually has. A
   * field is writable when it is a standard field, an ext field that exists or
   * was just created, or a rule-named field that already exists on the target.
   * Anything else is demoted to the note rather than silently dropped.
   */
  writable?: boolean;
  /** Per-field override of the workspace merge policy, from the matching rule. */
  mergeStrategy?: FieldMergeStrategy;
};

export type DatabaseRule = {
  inputPattern: string;
  canonicalName: string;
  fieldType: string;
  action?: FieldAction;
  priority: number;
  targetObject?: string | null;
  mergeStrategy?: string | null;
};

/**
 * A rule states its intent through `fieldType`: the list offers NOTE and SKIP
 * alongside the real Twenty types. There is no separate action column to read,
 * and reading one that does not exist is how a SKIP rule ended up writing the
 * value it was configured to discard — `action` came back undefined, and
 * `partition` treats anything that is not 'skip' or 'note' as a field to write.
 */
export function actionForRule(rule: DatabaseRule): FieldAction {
  if (rule.action) return rule.action;
  switch ((rule.fieldType ?? '').toUpperCase()) {
    case 'SKIP': return 'skip';
    case 'NOTE': return 'note';
    default: return 'field';
  }
}

/** NOTE and SKIP are instructions, not column types — give them a real one. */
export function typeForRule(rule: DatabaseRule): TwentyFieldType {
  switch ((rule.fieldType ?? '').toUpperCase()) {
    case 'NOTE': return 'RICH_TEXT';
    case 'SKIP': return 'TEXT';
    case '': return 'TEXT';
    default: return rule.fieldType as TwentyFieldType;
  }
}

/**
 * Explicit per-key routing to the deal. `opportunity_budget`, `opp_budget` and
 * `deal_budget` all put `extBudget` on the Opportunity, so a caller can route a
 * field without configuring a rule first.
 */
const OPPORTUNITY_KEY_PREFIXES = ['opportunity_', 'opp_', 'deal_'];

function parseTargetObject(raw: string | null | undefined): TargetObject {
  switch ((raw ?? '').toUpperCase()) {
    case 'PERSON': return 'person';
    case 'COMPANY': return 'company';
    case 'OPPORTUNITY': return 'opportunity';
    default: return 'auto';
  }
}

/**
 * The canonical names that make a contact findable and reachable.
 *
 * A rule outranks the built-in map everywhere except here. These five names are
 * the ones `assembleComposites` folds into `name`, `emails` and `phones`, and
 * `email` is additionally the key every person dedup runs on — so a pattern that
 * swept one of them into the note would create contacts with no address to write
 * to and a fresh duplicate on every submission, silently and forever.
 *
 * The protection is narrow: a rule may still restate one of these mappings, and
 * may still set its type, target and merge strategy. What it may not do is send
 * the value to a different field, to the note, or to the bin.
 *
 * A rule that wants a company address or a second phone should match a key the
 * built-in map does not already own (`company_email`, `alt_phone`); those are
 * unprotected and behave like any other key.
 */
const PROTECTED_CANONICAL_NAMES = new Set([
  'email', 'phone', 'firstName', 'lastName', 'fullName',
]);

type CompiledRule = DatabaseRule & { matcher: RegExp | null };

/**
 * Compile once per ingestion rather than once per key. An unparseable pattern
 * keeps the rule alive as an exact-match-only rule instead of discarding it.
 */
function compileRule(rule: DatabaseRule): CompiledRule {
  try {
    return { ...rule, matcher: new RegExp(rule.inputPattern, 'i') };
  } catch {
    return { ...rule, matcher: null };
  }
}

/**
 * Whether a rule claims a key.
 *
 * Both spellings of the key are offered to the pattern. `flatten` camelCases
 * every incoming key before rules run, so a payload sending `lead_id` arrives
 * here as `leadId`; testing only that form made `^lead_id$` silently never
 * match while the exact string `lead_id` matched fine through the equality
 * branch — the same rule working or not depending on whether the author reached
 * for a regex. Matching against the original and the normalised form makes
 * `^lead_id$` and `^leadId$` equally valid ways to say the same thing.
 */
function ruleMatches(rule: CompiledRule, key: string, lookupKey: string): boolean {
  if (rule.inputPattern === key || rule.inputPattern === lookupKey) return true;
  if (!rule.matcher) return false;
  return rule.matcher.test(key) || rule.matcher.test(lookupKey);
}

/**
 * Normalize a flat record of incoming key→value pairs into typed,
 * canonically-named fields ready for classification and schema sync.
 *
 * Strategy priority:
 *  1. Database rules      (highest — user-configured per source or global)
 *  2. Built-in field map  (covers known common variations)
 *  3. Passthrough         (unknown fields get an ext prefix + auto type detection)
 *
 * Rules come first because that is what "override the built-in map" has to mean
 * to be worth configuring: a source that reports `utm_source` as a real field,
 * or a `website` that belongs on the deal rather than the company, cannot be
 * expressed at all if a built-in entry silently wins first. The one exception is
 * PROTECTED_CANONICAL_NAMES.
 *
 * Anything the precedence declines is appended to `warnings`, so a rule that did
 * not do what its author expected says so on the log instead of being invisible.
 */
export function normalizeFields(
  flat: Record<string, unknown>,
  rules: DatabaseRule[] = [],
  warnings: string[] = [],
): NormalizedField[] {
  const compiled = [...rules]
    .sort((a, b) => b.priority - a.priority)
    .map(compileRule);

  return Object.entries(flat).map(([key, value]) =>
    normalizeField(key, value, compiled, warnings),
  );
}

function normalizeField(
  key: string,
  value: unknown,
  rules: CompiledRule[],
  warnings: string[],
): NormalizedField {
  const lookupKey = normaliseKey(key);
  const builtIn = FIELD_MAP[lookupKey];

  // 1. Database rules (exact match or regex), highest priority first
  for (const rule of rules) {
    if (!ruleMatches(rule, key, lookupKey)) continue;

    // A rule that agrees with the built-in about where a protected value goes is
    // free to restate it — that is what the seeded `emailAddress → email` rules
    // do, and declining them would warn on a workspace that has done nothing
    // wrong. Only a rule that would move the value somewhere else, or stop it
    // being written at all, is turned away.
    if (builtIn && PROTECTED_CANONICAL_NAMES.has(builtIn.canonicalName)) {
      const displaces =
        rule.canonicalName !== builtIn.canonicalName || actionForRule(rule) !== 'field';
      if (displaces) {
        warnings.push(
          `Rule "${rule.inputPattern}" matched "${key}", which the built-in map holds as the ` +
          `contact's ${builtIn.canonicalName}. The built-in mapping was kept: a contact with no ` +
          `${builtIn.canonicalName} cannot be found again, so every submission would create a ` +
          `duplicate. Point the rule at a key the built-in map does not already own.`,
        );
        continue;
      }
    }

    return {
      originalKey: key,
      canonicalName: rule.canonicalName,
      twentyType: typeForRule(rule),
      action: actionForRule(rule),
      value,
      source: 'rule',
      targetObject: parseTargetObject(rule.targetObject),
      mergeStrategy: parseFieldMergeStrategy(rule.mergeStrategy),
    };
  }

  // 2. Built-in map
  if (builtIn) {
    return {
      originalKey: key,
      canonicalName: builtIn.canonicalName,
      twentyType: builtIn.twentyType,
      action: builtIn.action,
      value,
      source: 'builtin',
      targetObject: 'auto',
    };
  }

  // 3. Passthrough — auto-detect type, classify, ext prefix
  const detectedType = detectType(value);
  const classification = classify(key, value);

  // An explicit opportunity prefix routes the field to the deal and is stripped
  // before the ext name is built, so `opportunity_budget` becomes `extBudget`
  // rather than `extOpportunityBudget`.
  const prefix = OPPORTUNITY_KEY_PREFIXES.find((p) => lookupKey.startsWith(p));
  const targetObject: TargetObject = prefix ? 'opportunity' : 'auto';
  const bareKey = prefix ? lookupKey.slice(prefix.length) : key;

  const canonicalName =
    classification === 'field'
      ? toExtFieldName(bareKey)
      : lookupKey;

  return {
    originalKey: key,
    canonicalName,
    twentyType: detectedType,
    action: classification === 'field' ? 'field' : classification,
    value,
    source: 'passthrough',
    targetObject,
  };
}

/** Convert any key to a valid Twenty custom field name: extPascalCase */
function toExtFieldName(key: string): string {
  const cleaned = key
    .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  return 'ext' + cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Split normalised fields into those that become CRM fields
 * and those that go into the overflow note.
 */
export function partition(fields: NormalizedField[]): {
  crmFields: NormalizedField[];
  noteFields: NormalizedField[];
  skipped: NormalizedField[];
} {
  const crmFields: NormalizedField[] = [];
  const noteFields: NormalizedField[] = [];
  const skipped: NormalizedField[] = [];

  for (const f of fields) {
    if (f.action === 'skip') skipped.push(f);
    else if (f.action === 'note') noteFields.push(f);
    else crmFields.push(f);
  }

  return { crmFields, noteFields, skipped };
}

/**
 * Assemble individual canonical field names into Twenty's composite
 * field structures (FULL_NAME, PHONES, EMAILS, ADDRESS, LINKS).
 */
export function assembleComposites(crmFields: NormalizedField[]): {
  assembled: Record<string, unknown>;
  remainder: NormalizedField[];
} {
  const assembled: Record<string, unknown> = {};
  const consumed = new Set<string>();

  // ── FULL_NAME ──────────────────────────────────────────────────────────
  const firstName = crmFields.find((f) => f.canonicalName === 'firstName');
  const lastName = crmFields.find((f) => f.canonicalName === 'lastName');
  const fullName = crmFields.find((f) => f.canonicalName === 'fullName');

  if (fullName && !firstName && !lastName) {
    const parts = splitFullName(String(fullName.value ?? ''));
    assembled['name'] = { firstName: parts[0], lastName: parts[1] };
    consumed.add('fullName');
  } else if (firstName || lastName) {
    assembled['name'] = {
      firstName: String(firstName?.value ?? ''),
      lastName: String(lastName?.value ?? ''),
    };
    if (firstName) consumed.add('firstName');
    if (lastName) consumed.add('lastName');
  }

  // ── EMAILS ─────────────────────────────────────────────────────────────
  const email = crmFields.find((f) => f.canonicalName === 'email');
  if (email) {
    assembled['emails'] = { primaryEmail: String(email.value ?? '') };
    consumed.add('email');
  }

  // ── PHONES ─────────────────────────────────────────────────────────────
  const phone = crmFields.find((f) => f.canonicalName === 'phone');
  if (phone) {
    const raw = String(phone.value ?? '');
    assembled['phones'] = {
      primaryPhoneNumber: raw.replace(/\D/g, '').slice(-10),
      primaryPhoneCountryCode: 'US',
      primaryPhoneCallingCode: '+1',
    };
    consumed.add('phone');
  }

  // ── LINKS (domainName / website) ───────────────────────────────────────
  const domain = crmFields.find((f) => f.canonicalName === 'domainName');
  if (domain) {
    assembled['domainName'] = {
      primaryLinkUrl: String(domain.value ?? ''),
      primaryLinkLabel: '',
    };
    consumed.add('domainName');
  }

  // ── ADDRESS ────────────────────────────────────────────────────────────
  const addressFields: Array<[string, string]> = [
    ['addressStreet1', 'addressStreet1'],
    ['addressStreet2', 'addressStreet2'],
    ['addressCity', 'addressCity'],
    ['addressState', 'addressState'],
    ['addressPostcode', 'addressPostcode'],
    ['addressCountry', 'addressCountry'],
  ];
  const addressParts: Record<string, unknown> = {};
  for (const [canonical, outKey] of addressFields) {
    const f = crmFields.find((x) => x.canonicalName === canonical);
    if (f) {
      addressParts[outKey] = f.value;
      consumed.add(canonical);
    }
  }
  if (Object.keys(addressParts).length > 0) {
    assembled['address'] = addressParts;
  }

  const remainder = crmFields.filter((f) => !consumed.has(f.canonicalName));
  return { assembled, remainder };
}

function splitFullName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return ['', ''];
  if (parts.length === 1) return [parts[0] ?? '', ''];
  const lastName = parts.pop() ?? '';
  return [parts.join(' '), lastName];
}
