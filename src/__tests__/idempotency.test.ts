import { describe, it, expect } from 'vitest';
import { computePayloadHash, withinWindow } from '../lib/idempotency';

describe('computePayloadHash', () => {
  it('produces a 64-char hex string', () => {
    const hash = computePayloadHash({ email: 'x@x.com' });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable — same payload produces same hash', () => {
    const a = computePayloadHash({ email: 'x@x.com', name: 'John' });
    const b = computePayloadHash({ email: 'x@x.com', name: 'John' });
    expect(a).toBe(b);
  });

  it('is order-independent — key order does not affect hash', () => {
    const a = computePayloadHash({ name: 'John', email: 'x@x.com' });
    const b = computePayloadHash({ email: 'x@x.com', name: 'John' });
    expect(a).toBe(b);
  });

  it('produces different hashes for different payloads', () => {
    const a = computePayloadHash({ email: 'a@a.com' });
    const b = computePayloadHash({ email: 'b@b.com' });
    expect(a).not.toBe(b);
  });
});

describe('withinWindow', () => {
  it('returns true for very recent timestamps', () => {
    expect(withinWindow(new Date())).toBe(true);
  });

  it('returns false for timestamps older than the window', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    expect(withinWindow(old)).toBe(false);
  });
});
