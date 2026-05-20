type FlatRecord = Record<string, unknown>;

const MAX_DEPTH = 8;

/**
 * Recursively flatten a nested object into a single-level record.
 * Arrays are kept as-is (classified as notes downstream).
 * Circular references are detected and dropped.
 *
 * e.g. { user: { phone: "x" } } → { userPhone: "x" }
 */
export function flatten(
  input: unknown,
  prefix = '',
  depth = 0,
  seen = new WeakSet<object>(),
): FlatRecord {
  if (depth > MAX_DEPTH) return {};
  if (input === null || input === undefined) return {};
  if (typeof input !== 'object') {
    return prefix ? { [prefix]: input } : {};
  }
  if (Array.isArray(input)) {
    return prefix ? { [prefix]: input } : {};
  }

  const obj = input as Record<string, unknown>;

  if (seen.has(obj)) return {};
  seen.add(obj);

  const result: FlatRecord = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}${toPascalSegment(key)}` : toCamelSegment(key);

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const nested = flatten(value, newKey, depth + 1, seen);
      Object.assign(result, nested);
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/** Convert a snake_case or kebab-case segment to camelCase. */
function toCamelSegment(s: string): string {
  return s.replace(/[-_]([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Convert a snake_case or kebab-case segment to PascalCase for joining. */
function toPascalSegment(s: string): string {
  const camel = toCamelSegment(s);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Detect whether a top-level payload is "structured" (pipeline-app style
 * with nested `company` / `person` object keys) or "flat" (contact-form style).
 */
export type PayloadStructure =
  | { type: 'structured'; company: FlatRecord | null; person: FlatRecord | null; extra: FlatRecord }
  | { type: 'flat'; data: FlatRecord };

export function detectStructure(raw: unknown): PayloadStructure {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { type: 'flat', data: {} };
  }

  const obj = raw as Record<string, unknown>;
  const hasObjectCompany =
    'company' in obj && typeof obj['company'] === 'object' && obj['company'] !== null && !Array.isArray(obj['company']);
  const hasObjectPerson =
    'person' in obj && typeof obj['person'] === 'object' && obj['person'] !== null && !Array.isArray(obj['person']);

  if (!hasObjectCompany && !hasObjectPerson) {
    return { type: 'flat', data: flatten(obj) };
  }

  // Keep company and person in their original nested form — they are already
  // in Twenty's native composite format (domainName, address, emails, phones, etc.)
  const company = hasObjectCompany ? (obj['company'] as FlatRecord) : null;
  const person = hasObjectPerson ? (obj['person'] as FlatRecord) : null;

  const extra: FlatRecord = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'company' || k === 'person') continue;
    const nested = flatten({ [k]: v });
    Object.assign(extra, nested);
  }

  return { type: 'structured', company, person, extra };
}
