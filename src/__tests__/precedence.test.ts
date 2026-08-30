import { describe, it, expect } from 'vitest';
import { normalizeFields, partition, assembleComposites, type DatabaseRule } from '../lib/normalizer';

function rule(overrides: Partial<DatabaseRule> = {}): DatabaseRule {
  return {
    inputPattern: 'lead_source',
    canonicalName: 'extLeadSource',
    fieldType: 'TEXT',
    priority: 50,
    ...overrides,
  };
}

/**
 * The README has always said a rule extends *or overrides* the built-in map.
 * The code checked the built-in map first, so it could only ever extend it —
 * `utm_source` was pinned to the note and `website` to the company domain no
 * matter what rule was configured, and the setting appeared to do nothing.
 */
describe('rules outrank the built-in map', () => {
  it('lets a rule pull a UTM value out of the note and onto a field', () => {
    const fields = normalizeFields(
      { utm_source: 'google' },
      [rule({ inputPattern: 'utm_source', canonicalName: 'extUtmSource', fieldType: 'TEXT' })],
    );
    const { crmFields, noteFields } = partition(fields);

    expect(crmFields.map((f) => f.canonicalName)).toContain('extUtmSource');
    expect(noteFields).toHaveLength(0);
    expect(fields[0]?.source).toBe('rule');
  });

  it('lets a rule send website somewhere other than the company domain', () => {
    const [field] = normalizeFields(
      { website: 'https://acme.com' },
      [rule({
        inputPattern: 'website',
        canonicalName: 'extSiteAudited',
        fieldType: 'LINKS',
        targetObject: 'OPPORTUNITY',
      })],
    );

    expect(field?.canonicalName).toBe('extSiteAudited');
    expect(field?.targetObject).toBe('opportunity');
  });

  it('lets a rule discard a built-in note field entirely', () => {
    const fields = normalizeFields(
      { referrer: 'https://spam.example' },
      [rule({ inputPattern: 'referrer', canonicalName: 'referrer', fieldType: 'SKIP' })],
    );
    expect(partition(fields).skipped).toHaveLength(1);
  });

  it('takes the highest-priority rule when two match the same key', () => {
    const [field] = normalizeFields({ utm_source: 'google' }, [
      rule({ inputPattern: 'utm_source', canonicalName: 'extLow', priority: 1 }),
      rule({ inputPattern: 'utm_source', canonicalName: 'extHigh', priority: 99 }),
    ]);
    expect(field?.canonicalName).toBe('extHigh');
  });

  it('still falls through to the built-in map when no rule matches', () => {
    const [field] = normalizeFields({ utm_source: 'google' }, [rule()]);
    expect(field?.source).toBe('builtin');
    expect(field?.action).toBe('note');
  });
});

/**
 * The protection that keeps the precedence change from creating unreachable
 * contacts. A rule may restate one of these mappings, and may set its type,
 * target and merge strategy — it may not move the value elsewhere or stop it
 * being written, because a person with no email is a person the next submission
 * cannot find and will duplicate.
 */
describe('a rule cannot take a contact away from itself', () => {
  it.each([
    ['email', 'x@example.com', 'email'],
    ['phone', '+15550100', 'phone'],
    ['first_name', 'Jane', 'firstName'],
    ['last_name', 'Doe', 'lastName'],
    ['name', 'Jane Doe', 'fullName'],
  ])('keeps %s on its built-in mapping when a rule would displace it', (key, value, canonical) => {
    const warnings: string[] = [];
    const [field] = normalizeFields(
      { [key]: value },
      [rule({ inputPattern: '.*', canonicalName: 'extEverything', fieldType: 'TEXT' })],
      warnings,
    );

    expect(field?.canonicalName).toBe(canonical);
    expect(field?.source).toBe('builtin');
    expect(warnings.join(' ')).toContain(canonical);
  });

  it.each(['NOTE', 'SKIP'])('refuses a %s rule that would silence the email', (fieldType) => {
    const warnings: string[] = [];
    const fields = normalizeFields(
      { email: 'jane@acme.com' },
      [rule({ inputPattern: 'email', canonicalName: 'email', fieldType })],
      warnings,
    );
    const { crmFields } = partition(fields);
    const { assembled } = assembleComposites(crmFields);

    expect(assembled['emails']).toEqual({ primaryEmail: 'jane@acme.com' });
    expect(warnings).toHaveLength(1);
  });

  it('allows a rule that restates the built-in mapping, without complaining', () => {
    const warnings: string[] = [];
    const [field] = normalizeFields(
      { emailAddress: 'jane@acme.com' },
      [rule({ inputPattern: 'emailAddress', canonicalName: 'email', fieldType: 'EMAILS' })],
      warnings,
    );

    // The rule seeded on every install must not start warning on every payload.
    expect(field?.canonicalName).toBe('email');
    expect(warnings).toHaveLength(0);
  });

  it('leaves an unprotected key entirely to the rule', () => {
    const warnings: string[] = [];
    const [field] = normalizeFields(
      { company_email: 'hello@acme.com' },
      [rule({ inputPattern: 'company_email', canonicalName: 'extCompanyEmail', fieldType: 'TEXT' })],
      warnings,
    );

    expect(field?.canonicalName).toBe('extCompanyEmail');
    expect(warnings).toHaveLength(0);
  });
});

/**
 * `flatten` camelCases every incoming key before rules run, so a payload
 * sending `lead_id` reaches the normalizer as `leadId`. Testing the pattern
 * against that form only made `^lead_id$` never match, while the bare string
 * `lead_id` matched fine through the equality branch — the same rule working or
 * not depending on whether its author reached for a regex.
 */
describe('patterns match both spellings of a key', () => {
  it.each([
    ['^lead_id$', 'leadId'],
    ['^leadId$', 'leadId'],
    ['^lead_id$', 'lead_id'],
    ['^utm_(source|medium)$', 'utmMedium'],
    ['_id$', 'externalId'],
  ])('pattern %s matches the key %s', (inputPattern, key) => {
    const [field] = normalizeFields(
      { [key]: 'abc123' },
      [rule({ inputPattern, canonicalName: 'extExternalId', fieldType: 'TEXT' })],
    );
    expect(field?.canonicalName).toBe('extExternalId');
    expect(field?.source).toBe('rule');
  });

  it('does not match a key the pattern genuinely excludes', () => {
    const [field] = normalizeFields(
      { accountId: 'abc123' },
      [rule({ inputPattern: '^lead_id$', canonicalName: 'extExternalId', fieldType: 'TEXT' })],
    );
    expect(field?.source).toBe('passthrough');
    expect(field?.canonicalName).toBe('extAccountId');
  });

  it('keeps an unparseable pattern alive as an exact match instead of dropping it', () => {
    const [field] = normalizeFields(
      { 'weird[key': 'value' },
      [rule({ inputPattern: 'weird[key', canonicalName: 'extWeird', fieldType: 'TEXT' })],
    );
    expect(field?.canonicalName).toBe('extWeird');
  });
});
