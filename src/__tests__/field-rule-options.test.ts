import { describe, it, expect } from 'vitest';
import fieldRuleObject from '../objects/intake-field-rule';
import { typeForRule, actionForRule, type DatabaseRule } from '../lib/normalizer';

type SelectField = { name: string; options?: Array<{ value: string }> };
type DefinitionResult = {
  success: boolean;
  errors?: unknown[];
  config: { fields: SelectField[] };
};

const definition = fieldRuleObject as unknown as DefinitionResult;

const optionsFor = (name: string): string[] => {
  const field = definition.config.fields.find((f) => f.name === name);
  if (!field) throw new Error(`intakeFieldRule has no field named "${name}"`);
  return (field.options ?? []).map((o) => o.value);
};

it('is a definition the SDK accepts', () => {
  // A rejected definition never reaches the workspace, so every assertion below
  // would be describing a dropdown nobody can open.
  expect(definition.success).toBe(true);
  expect(definition.errors ?? []).toHaveLength(0);
});

/**
 * A type the pipeline knows how to write but the dropdown does not offer is a
 * feature that exists only in the documentation. CURRENCY shipped that way in
 * 0.4.0: `formatExtValue` converted it to Twenty's amount micros and the README
 * listed it, but the rule that needed it could not be saved.
 */
describe('every documented field type can actually be chosen', () => {
  it('offers CURRENCY', () => {
    expect(optionsFor('fieldType')).toContain('CURRENCY');
  });

  it.each(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATE_TIME', 'CURRENCY', 'LINKS',
    'EMAILS', 'PHONES', 'RICH_TEXT', 'RAW_JSON', 'NOTE', 'SKIP'])(
    'offers %s',
    (value) => { expect(optionsFor('fieldType')).toContain(value); },
  );

  it('offers RAW_JSON, which passthrough already creates unattended', () => {
    // `detectType` returns RAW_JSON for an array or object value, so the schema
    // sync creates such columns on its own. A rule had no way to name one.
    expect(optionsFor('fieldType')).toContain('RAW_JSON');
  });

  it('offers no type the app cannot create unattended', () => {
    // SELECT needs options, RATING needs a scale, and FULL_NAME / ADDRESS are
    // composites the upsert only assembles from built-in parts. Offering any of
    // them would fail at the Metadata API after the user had saved the rule.
    for (const unsupported of ['SELECT', 'RATING', 'FULL_NAME', 'ADDRESS']) {
      expect(optionsFor('fieldType')).not.toContain(unsupported);
    }
  });

  it('resolves every offered type to a real column type and a real action', () => {
    for (const value of optionsFor('fieldType')) {
      const rule: DatabaseRule = {
        inputPattern: 'x', canonicalName: 'extX', fieldType: value, priority: 0,
      };
      expect(typeForRule(rule)).not.toBe('NOTE');
      expect(typeForRule(rule)).not.toBe('SKIP');
      expect(['field', 'note', 'skip']).toContain(actionForRule(rule));
    }
  });
});

describe('the other rule dropdowns match what the normalizer parses', () => {
  it('offers exactly the target objects the normalizer understands', () => {
    expect(optionsFor('targetObject').sort()).toEqual(
      ['AUTO', 'COMPANY', 'OPPORTUNITY', 'PERSON'],
    );
  });

  it('offers exactly the merge strategies the merge policy understands', () => {
    expect(optionsFor('mergeStrategy').sort()).toEqual(
      ['INHERIT', 'NEWEST_WINS', 'PRESERVE'],
    );
  });
});
