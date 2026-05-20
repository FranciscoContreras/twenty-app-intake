import { describe, it, expect } from 'vitest';
import { formatNote } from '../lib/note-formatter';

describe('formatNote', () => {
  it('always starts with the source name', () => {
    const note = formatNote('contact-form', { message: 'Hello' });
    expect(note).toContain('**Source:** contact-form');
  });

  it('formats key-value pairs as bold labels', () => {
    const note = formatNote('test', { message: 'Hello world' });
    expect(note).toContain('**Message:** Hello world');
  });

  it('skips null and empty values', () => {
    const note = formatNote('test', { empty: '', nothing: null, something: 'value' });
    expect(note).not.toContain('Empty');
    expect(note).not.toContain('Nothing');
    expect(note).toContain('**Something:** value');
  });

  it('converts ext_ prefixed keys to readable labels', () => {
    const note = formatNote('pipeline', { ext_googleRating: 4.2 });
    expect(note).toContain('**Google Rating:** 4.2');
  });

  it('converts snake_case keys to Title Case', () => {
    const note = formatNote('test', { utm_source: 'google' });
    expect(note).toContain('**Utm Source:** google');
  });

  it('serialises arrays as comma-separated values', () => {
    const note = formatNote('test', { tags: ['seo', 'web'] });
    expect(note).toContain('seo, web');
  });
});
