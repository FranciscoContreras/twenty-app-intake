import { describe, it, expect } from 'vitest';
import { scoreSpam, describeVerdict, HONEYPOT_SCORE } from '../lib/spam';

const DEFAULT_THRESHOLD = 5;

/** A payload that any real contact form would produce. */
const genuine = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@analyticalengine.co.uk',
  phone: '831-555-0100',
  company: 'Analytical Engine Co',
  message: 'We are looking for help with our website and would like to talk next week.',
};

describe('honeypot', () => {
  it('quarantines immediately when the trap field is filled', () => {
    const v = scoreSpam({ ...genuine, website_confirm: 'http://spam.example' }, 'website_confirm');
    expect(v.honeypot).toBe(true);
    expect(v.score).toBe(HONEYPOT_SCORE);
  });

  it('ignores the trap field when it arrives empty, as a real form sends it', () => {
    const v = scoreSpam({ ...genuine, website_confirm: '' }, 'website_confirm');
    expect(v.honeypot).toBe(false);
    expect(v.score).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it('matches the configured key whatever case the form used', () => {
    const v = scoreSpam({ ...genuine, Website_Confirm: 'x' }, 'website_confirm');
    expect(v.honeypot).toBe(true);
  });

  it('does nothing when no honeypot is configured', () => {
    const v = scoreSpam({ ...genuine, website_confirm: 'filled' }, '');
    expect(v.honeypot).toBe(false);
  });
});

describe('scoring — payloads that must get through', () => {
  it('clears an ordinary enquiry', () => {
    const v = scoreSpam(genuine);
    expect(v.score).toBe(0);
    expect(v.signals).toHaveLength(0);
  });

  it('clears an enquiry that mentions a URL in the message body', () => {
    const v = scoreSpam({ ...genuine, message: 'Our site is https://example.co.uk and it needs work.' });
    expect(v.score).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it('clears a lead with a personal free-mail address', () => {
    const v = scoreSpam({ ...genuine, email: 'ada.lovelace@gmail.com' });
    expect(v.score).toBeLessThan(DEFAULT_THRESHOLD);
  });

  // One odd signal is not a verdict. A disposable address alone is worth 4,
  // under the threshold of 5, so a real person using one still gets through.
  it('does not quarantine on a disposable address alone', () => {
    const v = scoreSpam({ ...genuine, email: 'ada@mailinator.com' });
    expect(v.score).toBeGreaterThan(0);
    expect(v.score).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it('does not penalise a non-Latin name', () => {
    const v = scoreSpam({ ...genuine, firstName: '愛', lastName: '田中' });
    expect(v.score).toBe(0);
  });

  it('does not penalise a message about SEO', () => {
    const v = scoreSpam({ ...genuine, message: 'We need SEO services and help with our Google ranking.' });
    expect(v.score).toBe(0);
  });

  it('ignores a short value repeated across address fields', () => {
    const v = scoreSpam({ ...genuine, city: 'Salinas', addressCity: 'Salinas', town: 'Salinas', region: 'Salinas' });
    expect(v.score).toBe(0);
  });
});

describe('scoring — payloads that should be held', () => {
  it('catches a link in the name field paired with a link blast', () => {
    const v = scoreSpam({
      name: 'Buy now http://cheap.example',
      email: 'x@mailinator.com',
      message: 'http://a.example http://b.example http://c.example http://d.example http://e.example',
    });
    expect(v.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
  });

  it('catches an anchor tag in a name alongside a placeholder address', () => {
    const v = scoreSpam({
      name: '<a href="http://spam.example">click</a>',
      email: 'test@example.com',
      message: 'hello',
    });
    expect(v.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
  });

  it('catches a malformed address next to a placeholder phone', () => {
    const v = scoreSpam({
      name: 'aaa',
      email: 'not-an-email',
      phone: '5555555555',
      message: 'hi',
    });
    expect(v.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
  });

  it('catches the same long string pasted into every box', () => {
    const filler = 'qwertyuiopasdfgh';
    const v = scoreSpam({
      firstName: filler, lastName: filler, company: filler,
      message: filler, email: 'x@mailinator.com',
    });
    expect(v.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
  });

  it('flags a sequential placeholder phone number', () => {
    const v = scoreSpam({ ...genuine, phone: '1234567890' });
    expect(v.signals.some((s) => /placeholder number/.test(s.reason))).toBe(true);
  });
});

describe('describeVerdict', () => {
  it('names every signal so a reviewer can judge the call', () => {
    const v = scoreSpam({ name: 'http://x.example', email: 'a@mailinator.com' });
    const text = describeVerdict(v);
    expect(text).toMatch(/URL/);
    expect(text).toMatch(/disposable/);
  });

  it('returns an empty string for a clean payload', () => {
    expect(describeVerdict(scoreSpam(genuine))).toBe('');
  });
});
