import { describe, it, expect } from 'vitest';
import { detectType } from '../lib/type-detector';

describe('detectType', () => {
  it.each([
    [true, 'BOOLEAN'],
    [false, 'BOOLEAN'],
    [42, 'NUMBER'],
    [3.14, 'NUMBER'],
    ['https://example.com', 'LINKS'],
    ['http://foo.bar/path?q=1', 'LINKS'],
    ['jane@example.com', 'EMAILS'],
    ['5550100', 'PHONES'],
    ['+1-800-555-0199', 'PHONES'],
    ['2026-05-19', 'DATE_TIME'],
    ['2026-05-19T10:30:00Z', 'DATE_TIME'],
    ['42', 'NUMBER'],
    ['hello world', 'TEXT'],
    [['a', 'b'], 'RAW_JSON'],
    [{ key: 'val' }, 'RAW_JSON'],
  ])('detects %s as %s', (input, expected) => {
    expect(detectType(input)).toBe(expected);
  });
});
