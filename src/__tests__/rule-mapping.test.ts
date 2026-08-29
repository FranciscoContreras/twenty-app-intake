import { describe, it, expect } from 'vitest';
import { actionForRule, typeForRule, normalizeFields, partition, type DatabaseRule } from '../lib/normalizer';

function rule(overrides: Partial<DatabaseRule> = {}): DatabaseRule {
  return {
    inputPattern: 'lead_source',
    canonicalName: 'extLeadSource',
    fieldType: 'TEXT',
    priority: 0,
    ...overrides,
  };
}

/**
 * A rule states its intent through fieldType — the list offers NOTE and SKIP
 * alongside the real Twenty types. There is no separate action column, and
 * reading one that does not exist left `action` undefined, which `partition`
 * treats as "write it". A SKIP rule therefore wrote the value it was configured
 * to discard, and a NOTE rule tried to create a column called NOTE.
 */
describe('actionForRule', () => {
  it('derives skip from a SKIP rule', () => {
    expect(actionForRule(rule({ fieldType: 'SKIP' }))).toBe('skip');
  });

  it('derives note from a NOTE rule', () => {
    expect(actionForRule(rule({ fieldType: 'NOTE' }))).toBe('note');
  });

  it('treats every real field type as a field to write', () => {
    for (const t of ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE_TIME', 'LINKS', 'EMAILS', 'PHONES']) {
      expect(actionForRule(rule({ fieldType: t }))).toBe('field');
    }
  });

  it('falls back to writing the field when the type is missing', () => {
    expect(actionForRule(rule({ fieldType: '' }))).toBe('field');
  });
});

describe('typeForRule', () => {
  it('gives NOTE and SKIP real column types instead of passing their names through', () => {
    expect(typeForRule(rule({ fieldType: 'NOTE' }))).toBe('RICH_TEXT');
    expect(typeForRule(rule({ fieldType: 'SKIP' }))).toBe('TEXT');
  });

  it('passes a real type through unchanged', () => {
    expect(typeForRule(rule({ fieldType: 'NUMBER' }))).toBe('NUMBER');
  });

  it('defaults an empty type to TEXT', () => {
    expect(typeForRule(rule({ fieldType: '' }))).toBe('TEXT');
  });
});

describe('rules end to end', () => {
  it('a SKIP rule actually discards the value', () => {
    const fields = normalizeFields(
      { internal_ref: 'abc123' },
      [rule({ inputPattern: 'internal_ref', canonicalName: 'internalRef', fieldType: 'SKIP' })],
    );
    const { skipped, crmFields } = partition(fields);

    expect(skipped.map((f) => f.originalKey)).toContain('internal_ref');
    expect(crmFields.map((f) => f.originalKey)).not.toContain('internal_ref');
  });

  it('a NOTE rule routes the value to the note, not to a column', () => {
    const fields = normalizeFields(
      { referral_detail: 'Met at a conference' },
      [rule({ inputPattern: 'referral_detail', canonicalName: 'referralDetail', fieldType: 'NOTE' })],
    );
    const { noteFields, crmFields } = partition(fields);

    expect(noteFields.map((f) => f.originalKey)).toContain('referral_detail');
    expect(crmFields).toHaveLength(0);
  });

  it('carries a rule target object through to the field', () => {
    const [field] = normalizeFields(
      { budget: '25000' },
      [rule({ inputPattern: 'budget', canonicalName: 'amount', fieldType: 'CURRENCY', targetObject: 'OPPORTUNITY' })],
    );
    expect(field?.targetObject).toBe('opportunity');
  });

  it('carries a rule merge strategy through to the field', () => {
    const [field] = normalizeFields(
      { score: '90' },
      [rule({ inputPattern: 'score', canonicalName: 'extScore', fieldType: 'NUMBER', mergeStrategy: 'NEWEST_WINS' })],
    );
    expect(field?.mergeStrategy).toBe('NEWEST_WINS');
  });

  it('defaults an unset target and strategy to the inheriting values', () => {
    const [field] = normalizeFields({ lead_source: 'google' }, [rule()]);
    expect(field?.targetObject).toBe('auto');
    expect(field?.mergeStrategy).toBe('INHERIT');
  });
});
