import { describe, it, expect } from 'vitest';
import { normaliseKey } from '../constants/field-map';
import { normalizeFields, partition, assembleComposites } from '../lib/normalizer';
import { flatten } from '../lib/flattener';

/**
 * The path a real payload takes: flattened, normalised, then composed the way
 * UpsertRecordStage composes it — composites first, then everything that is not
 * part of one folded in beside them.
 */
const ingest = (payload: Record<string, unknown>) => {
  const { crmFields } = partition(normalizeFields(flatten(payload)));
  const { assembled, remainder } = assembleComposites(crmFields);
  for (const f of remainder) assembled[f.canonicalName] = f.value;
  return assembled;
};

/**
 * Most form builders label their fields for humans — "Email", "Phone",
 * "First Name" — and send those labels as the payload keys. Prefixing an
 * underscore to every capital turned `Email` into `_email`, which matches
 * nothing in the built-in map, so the value fell through to passthrough as an
 * `extEmail` column. The person was written with no email address on the record,
 * and because dedup runs on `emails.primaryEmail` the next submission from the
 * same person created another one, and the one after that another.
 */
describe('normaliseKey', () => {
  it.each([
    ['Email', 'email'],
    ['Phone', 'phone'],
    ['Company', 'company'],
    ['Website', 'website'],
    ['First Name', 'first_name'],
    ['FirstName', 'first_name'],
    ['Last Name', 'last_name'],
    ['EMAIL', 'email'],
    ['PHONE', 'phone'],
    ['phoneNumber', 'phone_number'],
    ['E-Mail', 'e_mail'],
    ['utm_source', 'utm_source'],
    ['email', 'email'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseKey(input)).toBe(expected);
  });

  it('leaves a leading underscore that was already in the key', () => {
    // The `_id` skip entry depends on this.
    expect(normaliseKey('_id')).toBe('_id');
  });

  it('splits a run of capitals before a word', () => {
    expect(normaliseKey('XMLHttpRequest')).toBe('xml_http_request');
  });
});

describe('a capitalised form label still reaches the record', () => {
  it('puts a capitalised Email on the person, not in a custom column', () => {
    const assembled = ingest({ 'Email': 'jane@acme.com' });
    expect(assembled['emails']).toEqual({ primaryEmail: 'jane@acme.com' });
  });

  it('assembles capitalised name labels into the name composite', () => {
    const assembled = ingest({ 'First Name': 'Jane', 'Last Name': 'Doe' });
    expect(assembled['name']).toEqual({ firstName: 'Jane', lastName: 'Doe' });
  });

  it('reads a capitalised Phone as a phone number', () => {
    const assembled = ingest({ 'Phone': '(831) 855-0020' });
    expect((assembled['phones'] as Record<string, string>)['primaryPhoneNumber']).toBe('8318550020');
  });

  it('still skips the internal keys it always skipped', () => {
    const fields = normalizeFields({ _id: '123', password: 'secret', token: 'abc' });
    expect(fields.every((f) => f.action === 'skip')).toBe(true);
  });

  it('handles a whole capitalised contact form in one go', () => {
    const assembled = ingest({
      'First Name': 'Jane',
      'Last Name': 'Doe',
      'Email': 'jane@acme.com',
      'Phone': '831-855-0020',
      'Company': 'Acme Roofing',
    });

    expect(assembled['name']).toEqual({ firstName: 'Jane', lastName: 'Doe' });
    expect(assembled['emails']).toEqual({ primaryEmail: 'jane@acme.com' });
    expect(assembled['companyName']).toBe('Acme Roofing');
  });
});
