import { describe, it, expect, afterEach } from 'vitest';
import { redactCredentials, prepareForStorage, REDACTED } from '../lib/retention';

const ENV_KEYS = ['INTAKE_RAW_PAYLOAD_RETENTION', 'INTAKE_RAW_PAYLOAD_MAX_BYTES'];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('redactCredentials', () => {
  it('strips a password while keeping everything beside it', () => {
    const out = redactCredentials({ email: 'ada@example.org', password: 'hunter2' }) as Record<string, unknown>;
    expect(out['password']).toBe(REDACTED);
    expect(out['email']).toBe('ada@example.org');
  });

  it('matches credential keys as substrings, whatever the casing', () => {
    const out = redactCredentials({
      stripe_secret_key: 'sk_live_x',
      apiToken: 'tok',
      CVV: '123',
      Authorization: 'Bearer x',
    }) as Record<string, unknown>;

    for (const value of Object.values(out)) expect(value).toBe(REDACTED);
  });

  it('reaches credentials nested inside the payload', () => {
    const out = redactCredentials({
      lead: { name: 'Ada', auth: { token: 'abc' } },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(out['lead']?.['auth']).toBe(REDACTED);
    expect(out['lead']?.['name']).toBe('Ada');
  });

  it('leaves ordinary lead fields alone', () => {
    const payload = { firstName: 'Ada', email: 'ada@example.org', message: 'hello', budget: 5000 };
    expect(redactCredentials(payload)).toEqual(payload);
  });

  it('preserves arrays and their contents', () => {
    const out = redactCredentials({ services: ['seo', 'ads'] }) as Record<string, unknown>;
    expect(out['services']).toEqual(['seo', 'ads']);
  });
});

describe('prepareForStorage', () => {
  it('stores a payload verbatim by default, so replay reproduces it', () => {
    const payload = { firstName: 'Ada', email: 'ada@example.org' };
    const { stored, warning } = prepareForStorage(payload);

    expect(warning).toBeNull();
    expect(JSON.parse(stored as string)).toEqual(payload);
  });

  it('stores nothing when retention is off', () => {
    process.env['INTAKE_RAW_PAYLOAD_RETENTION'] = 'NONE';
    const { stored, warning } = prepareForStorage({ firstName: 'Ada' });

    expect(stored).toBeNull();
    // Retention being off is a deliberate choice, not a fault worth warning about.
    expect(warning).toBeNull();
  });

  // A truncated JSON document cannot be parsed, so it cannot be replayed.
  // Dropping it and saying so beats storing a replay that fails later.
  it('drops an oversized payload rather than truncating it, and says why', () => {
    process.env['INTAKE_RAW_PAYLOAD_MAX_BYTES'] = '100';
    const { stored, warning } = prepareForStorage({ message: 'x'.repeat(500) });

    expect(stored).toBeNull();
    expect(warning).toMatch(/exceeds INTAKE_RAW_PAYLOAD_MAX_BYTES/);
  });

  it('keeps a payload that fits the configured cap', () => {
    process.env['INTAKE_RAW_PAYLOAD_MAX_BYTES'] = '10000';
    const { stored } = prepareForStorage({ message: 'x'.repeat(500) });
    expect(stored).not.toBeNull();
  });

  it('never stores a credential, even under FULL retention', () => {
    const { stored } = prepareForStorage({ email: 'ada@example.org', password: 'hunter2' });
    expect(stored).not.toMatch(/hunter2/);
    expect(stored).toMatch(/ada@example.org/);
  });
});
