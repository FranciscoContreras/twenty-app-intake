import { describe, it, expect } from 'vitest';
import { classify } from '../lib/classifier';

describe('classify', () => {
  it('sends known note field names to note', () => {
    expect(classify('message', 'hi')).toBe('note');
    expect(classify('description', 'short')).toBe('note');
    expect(classify('analysis', 'x')).toBe('note');
    expect(classify('notes', 'y')).toBe('note');
  });

  it('sends utm params to note', () => {
    expect(classify('utm_source', 'google')).toBe('note');
    expect(classify('utm_campaign', 'spring')).toBe('note');
  });

  it('sends arrays to note', () => {
    expect(classify('tags', ['a', 'b'])).toBe('note');
  });

  it('sends objects to note', () => {
    expect(classify('meta', { foo: 'bar' })).toBe('note');
  });

  it('sends multi-line text to note', () => {
    expect(classify('bio', 'Line one\nLine two')).toBe('note');
  });

  it('sends prose (2+ sentences) to note', () => {
    const prose = 'This is one sentence. This is a second sentence. And a third.';
    expect(classify('about', prose)).toBe('note');
  });

  it('keeps short strings as field', () => {
    expect(classify('city', 'San Francisco')).toBe('field');
  });

  it('keeps URLs as field', () => {
    expect(classify('website', 'https://example.com')).toBe('field');
  });

  it('keeps numbers as field', () => {
    expect(classify('rating', 4.2)).toBe('field');
  });

  it('keeps booleans as field', () => {
    expect(classify('verified', true)).toBe('field');
  });
});
