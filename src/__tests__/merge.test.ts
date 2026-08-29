import { describe, it, expect } from 'vitest';
import { decideMerge, mergePatch, isEmpty } from '../lib/merge';

describe('isEmpty', () => {
  it('treats null, undefined and blank strings as empty', () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty('')).toBe(true);
    expect(isEmpty('   ')).toBe(true);
  });

  it('treats zero and false as present, because they are answers', () => {
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
  });

  // An unset composite comes back from Twenty as a shape full of empty strings,
  // not as null. Reading that as "already has a value" would stop PRESERVE ever
  // populating a record.
  it('sees through an unset FULL_NAME composite', () => {
    expect(isEmpty({ firstName: '', lastName: '' })).toBe(true);
    expect(isEmpty({ firstName: 'Ada', lastName: '' })).toBe(false);
  });

  it('ignores composite metadata that carries no value of its own', () => {
    expect(isEmpty({ primaryLinkUrl: '', primaryLinkLabel: '' })).toBe(true);
    expect(isEmpty({ amountMicros: null, currencyCode: 'USD' })).toBe(true);
    expect(isEmpty({ amountMicros: 5_000_000, currencyCode: 'USD' })).toBe(false);
  });

  it('sees an unset phone composite as empty despite its country code', () => {
    expect(isEmpty({
      primaryPhoneNumber: '',
      primaryPhoneCountryCode: 'US',
      primaryPhoneCallingCode: '+1',
    })).toBe(true);
  });
});

describe('decideMerge', () => {
  it('never writes a blank over an existing value, under either policy', () => {
    expect(decideMerge('Ada Lovelace', '', 'NEWEST_WINS').write).toBe(false);
    expect(decideMerge('Ada Lovelace', null, 'NEWEST_WINS').write).toBe(false);
    expect(decideMerge('Ada Lovelace', '   ', 'PRESERVE').write).toBe(false);
  });

  it('fills a field that is empty', () => {
    const d = decideMerge('', 'ada@example.org', 'PRESERVE');
    expect(d.write).toBe(true);
    expect(d.status).toBe('filled-empty');
  });

  it('writes to a brand new record', () => {
    expect(decideMerge(undefined, 'Ada', 'PRESERVE').write).toBe(true);
  });

  it('keeps the existing value under PRESERVE', () => {
    const d = decideMerge('Ada Lovelace', 'ada lovelace', 'PRESERVE');
    expect(d.write).toBe(false);
    expect(d.status).toBe('preserved');
  });

  it('replaces the existing value under NEWEST_WINS', () => {
    const d = decideMerge('Ada Lovelace', 'A. Lovelace', 'NEWEST_WINS');
    expect(d.write).toBe(true);
    expect(d.status).toBe('set');
  });

  it('reports an identical value as unchanged rather than writing it', () => {
    const d = decideMerge('Ada', 'Ada', 'NEWEST_WINS');
    expect(d.write).toBe(false);
    expect(d.status).toBe('unchanged');
  });

  it('compares composites by content, not by reference', () => {
    const d = decideMerge(
      { lastName: 'Lovelace', firstName: 'Ada' },
      { firstName: 'Ada', lastName: 'Lovelace' },
      'NEWEST_WINS',
    );
    expect(d.status).toBe('unchanged');
  });

  it('lets a per-field strategy override the workspace policy in both directions', () => {
    expect(decideMerge('old', 'new', 'PRESERVE', 'NEWEST_WINS').write).toBe(true);
    expect(decideMerge('old', 'new', 'NEWEST_WINS', 'PRESERVE').write).toBe(false);
  });

  it('follows the policy when the strategy is INHERIT', () => {
    expect(decideMerge('old', 'new', 'NEWEST_WINS', 'INHERIT').write).toBe(true);
    expect(decideMerge('old', 'new', 'PRESERVE', 'INHERIT').write).toBe(false);
  });
});

describe('mergePatch', () => {
  const existing = {
    id: 'p1',
    name: { firstName: 'Ada', lastName: 'Lovelace' },
    emails: { primaryEmail: 'ada@example.org' },
    phones: { primaryPhoneNumber: '', primaryPhoneCountryCode: 'US' },
    extLeadScore: 40,
  };

  it('under PRESERVE, fills the blank and protects everything already written', () => {
    const { patch } = mergePatch(existing, {
      name: { firstName: 'ada', lastName: 'lovelace' },
      phones: { primaryPhoneNumber: '8315550100' },
      extLeadScore: 90,
    }, 'PRESERVE');

    // The phone was blank, so it fills.
    expect(patch).toHaveProperty('phones');
    // The name and the score were not, so they hold.
    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('extLeadScore');
  });

  it('under NEWEST_WINS, replaces what differs', () => {
    const { patch } = mergePatch(existing, { extLeadScore: 90 }, 'NEWEST_WINS');
    expect(patch['extLeadScore']).toBe(90);
  });

  it('honours a per-field strategy inside a PRESERVE patch', () => {
    const { patch } = mergePatch(
      existing,
      { name: { firstName: 'ada', lastName: 'lovelace' }, extLeadScore: 90 },
      'PRESERVE',
      (field) => (field === 'extLeadScore' ? 'NEWEST_WINS' : 'INHERIT'),
    );

    expect(patch['extLeadScore']).toBe(90);
    expect(patch).not.toHaveProperty('name');
  });

  it('produces an empty patch when nothing may be written', () => {
    const { patch } = mergePatch(existing, { name: { firstName: 'x', lastName: 'y' } }, 'PRESERVE');
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it('records a decision for every incoming field, written or not', () => {
    const { decisions } = mergePatch(existing, { extLeadScore: 90, phones: { primaryPhoneNumber: '1' } }, 'PRESERVE');
    expect(Object.keys(decisions).sort()).toEqual(['extLeadScore', 'phones']);
  });
});
