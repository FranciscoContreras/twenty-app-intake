import { describe, it, expect } from 'vitest';
import { normalizeFields, partition, assembleComposites } from '../lib/normalizer';

describe('normalizeFields — built-in map', () => {
  it.each([
    ['phone', 'phone'],
    ['phone_number', 'phone'],
    ['phoneNumber', 'phone'],
    ['tel', 'phone'],
    ['mobile', 'phone'],
    ['cell', 'phone'],
  ])('maps %s → canonical "phone"', (input, expected) => {
    const [result] = normalizeFields({ [input]: '+15550100' });
    expect(result?.canonicalName).toBe(expected);
  });

  it.each([
    ['email', 'email'],
    ['email_address', 'email'],
    ['contact_email', 'email'],
  ])('maps %s → canonical "email"', (input, expected) => {
    const [result] = normalizeFields({ [input]: 'x@x.com' });
    expect(result?.canonicalName).toBe(expected);
  });

  it('maps first_name and last_name correctly', () => {
    const fields = normalizeFields({ first_name: 'Jane', last_name: 'Doe' });
    const names = fields.map((f) => f.canonicalName);
    expect(names).toContain('firstName');
    expect(names).toContain('lastName');
  });

  it('marks utm_source as note action', () => {
    const [f] = normalizeFields({ utm_source: 'google' });
    expect(f?.action).toBe('note');
  });

  it('marks message as note action', () => {
    const [f] = normalizeFields({ message: 'Hello' });
    expect(f?.action).toBe('note');
  });

  it('skips _id, password, and token fields', () => {
    const fields = normalizeFields({ _id: '123', password: 'secret', token: 'abc' });
    expect(fields.every((f) => f.action === 'skip')).toBe(true);
  });
});

describe('normalizeFields — passthrough', () => {
  it('prefixes unknown field names with extCamelCase', () => {
    const [f] = normalizeFields({ biz_type: 'plumbing' });
    expect(f?.canonicalName).toBe('extBizType');
    expect(f?.source).toBe('passthrough');
  });

  it('auto-detects URL type for link fields', () => {
    const [f] = normalizeFields({ portfolio_link: 'https://example.com' });
    expect(f?.twentyType).toBe('LINKS');
  });
});

describe('assembleComposites', () => {
  it('assembles firstName + lastName into name composite', () => {
    const fields = normalizeFields({ first_name: 'Jane', last_name: 'Doe' });
    const { crmFields } = partition(fields);
    const { assembled } = assembleComposites(crmFields);
    expect(assembled['name']).toEqual({ firstName: 'Jane', lastName: 'Doe' });
  });

  it('splits full name into firstName and lastName', () => {
    const fields = normalizeFields({ name: 'Jane Doe' });
    const { crmFields } = partition(fields);
    const { assembled } = assembleComposites(crmFields);
    expect((assembled['name'] as Record<string, string>)['firstName']).toBe('Jane');
    expect((assembled['name'] as Record<string, string>)['lastName']).toBe('Doe');
  });

  it('assembles email into EMAILS composite', () => {
    const fields = normalizeFields({ email: 'jane@co.com' });
    const { crmFields } = partition(fields);
    const { assembled } = assembleComposites(crmFields);
    expect(assembled['emails']).toEqual({ primaryEmail: 'jane@co.com' });
  });

  it('assembles website into LINKS composite', () => {
    const fields = normalizeFields({ website: 'https://acme.com' });
    const { crmFields } = partition(fields);
    const { assembled } = assembleComposites(crmFields);
    expect((assembled['domainName'] as Record<string, string>)['primaryLinkUrl']).toBe('https://acme.com');
  });
});
