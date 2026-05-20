import { describe, it, expect } from 'vitest';
import { flatten, detectStructure } from '../lib/flattener';
import contactForm from './fixtures/payloads/contact-form.json';
import pipelineApp from './fixtures/payloads/pipeline-app.json';
import arbitrary from './fixtures/payloads/arbitrary.json';

describe('flatten', () => {
  it('passes top-level primitives through unchanged', () => {
    expect(flatten({ name: 'John', age: 30 })).toEqual({ name: 'John', age: 30 });
  });

  it('flattens one level of nesting with camelCase key join', () => {
    expect(flatten({ user: { phone: '555' } })).toEqual({ userPhone: '555' });
  });

  it('flattens deep nesting with proper camelCase joining', () => {
    expect(flatten({ a: { b: { c: 'x' } } })).toEqual({ aBC: 'x' });
  });

  it('keeps arrays intact (they go to note downstream)', () => {
    const result = flatten({ tags: ['a', 'b'] });
    expect(result['tags']).toEqual(['a', 'b']);
  });

  it('drops null and undefined gracefully', () => {
    expect(flatten({ x: null, y: undefined })).toEqual({ x: null, y: undefined });
  });

  it('handles moderate nesting and converts snake_case keys to camelCase', () => {
    const result = flatten({ submitted_by: { full_name: 'Jane' } });
    expect(result).toHaveProperty('submittedByFullName', 'Jane');
  });

  it('does not crash on excessively deep objects', () => {
    let deep: Record<string, unknown> = { val: 'end' };
    for (let i = 0; i < 15; i++) deep = { child: deep };
    expect(() => flatten(deep)).not.toThrow();
  });
});

describe('detectStructure', () => {
  it('detects contact form as flat', () => {
    const s = detectStructure(contactForm);
    expect(s.type).toBe('flat');
  });

  it('detects pipeline app payload as structured', () => {
    const s = detectStructure(pipelineApp);
    expect(s.type).toBe('structured');
    if (s.type === 'structured') {
      expect(s.company).not.toBeNull();
      expect(s.person).not.toBeNull();
    }
  });

  it('treats string company field as flat (contact form style)', () => {
    const s = detectStructure({ company: 'Acme', email: 'test@test.com' });
    expect(s.type).toBe('flat');
  });

  it('extracts extra fields from structured payload as camelCase', () => {
    const s = detectStructure(pipelineApp);
    if (s.type === 'structured') {
      // snake_case extra keys are camelCased by flatten
      expect(s.extra).toHaveProperty('googlePlacesUrl');
      expect(s.extra).toHaveProperty('analysis');
      expect(s.extra).toHaveProperty('googleRating');
    }
  });

  it('handles arbitrary nested payload and camelCases nested keys', () => {
    const s = detectStructure(arbitrary);
    expect(s.type).toBe('flat');
    if (s.type === 'flat') {
      // submitted_by.full_name → submittedByFullName
      expect(s.data).toHaveProperty('submittedByFullName');
      expect(s.data['submittedByFullName']).toBe('Maria Garcia');
    }
  });
});
