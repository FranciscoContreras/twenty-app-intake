import { FIELD_MAP, normaliseKey, type FieldAction, type TwentyFieldType } from '../constants/field-map';
import { detectType } from './type-detector';
import { classify } from './classifier';

export type NormalizedField = {
  originalKey: string;
  canonicalName: string;
  twentyType: TwentyFieldType;
  action: FieldAction;
  value: unknown;
  source: 'builtin' | 'rule' | 'passthrough';
};

export type DatabaseRule = {
  inputPattern: string;
  canonicalName: string;
  fieldType: string;
  action: FieldAction;
  priority: number;
};

/**
 * Normalize a flat record of incoming key→value pairs into typed,
 * canonically-named fields ready for classification and schema sync.
 *
 * Strategy priority:
 *  1. Built-in field map  (highest — covers known common variations)
 *  2. Database rules      (user-configured per source or global)
 *  3. Passthrough         (unknown fields get ext_ prefix + auto type detection)
 */
export function normalizeFields(
  flat: Record<string, unknown>,
  rules: DatabaseRule[] = [],
): NormalizedField[] {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  return Object.entries(flat).map(([key, value]) =>
    normalizeField(key, value, sorted),
  );
}

function normalizeField(
  key: string,
  value: unknown,
  rules: DatabaseRule[],
): NormalizedField {
  const lookupKey = normaliseKey(key);

  // 1. Built-in map
  const builtIn = FIELD_MAP[lookupKey];
  if (builtIn) {
    return {
      originalKey: key,
      canonicalName: builtIn.canonicalName,
      twentyType: builtIn.twentyType,
      action: builtIn.action,
      value,
      source: 'builtin',
    };
  }

  // 2. Database rules (exact match or regex)
  for (const rule of rules) {
    let matches = false;
    try {
      matches =
        rule.inputPattern === key ||
        rule.inputPattern === lookupKey ||
        new RegExp(rule.inputPattern, 'i').test(key);
    } catch {
      matches = rule.inputPattern === key;
    }

    if (matches) {
      return {
        originalKey: key,
        canonicalName: rule.canonicalName,
        twentyType: rule.fieldType as TwentyFieldType,
        action: rule.action,
        value,
        source: 'rule',
      };
    }
  }

  // 3. Passthrough — auto-detect type, classify, ext_ prefix
  const detectedType = detectType(value);
  const classification = classify(key, value);
  const canonicalName =
    classification === 'field'
      ? toExtFieldName(key)
      : lookupKey;

  return {
    originalKey: key,
    canonicalName,
    twentyType: detectedType,
    action: classification === 'field' ? 'field' : classification,
    value,
    source: 'passthrough',
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
