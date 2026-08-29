import { describe, it, expect } from 'vitest';
import { assess, type SourceHealth } from '../lib/silence';

const NOW = new Date('2026-08-29T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

function source(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    id: 's1',
    name: 'Contact Form',
    slug: 'contact-form',
    status: 'ACTIVE',
    expectedCadenceHours: 24,
    lastIngestedAt: new Date(NOW - 2 * HOUR).toISOString(),
    healthStatus: 'HEALTHY',
    silentSince: null,
    lastAlertAt: null,
    alertWebhookUrl: null,
    ...overrides,
  };
}

describe('assess', () => {
  it('calls a source healthy while it is inside its cadence', () => {
    expect(assess(source(), NOW).health).toBe('HEALTHY');
  });

  it('calls a source silent once the cadence has elapsed', () => {
    const v = assess(source({ lastIngestedAt: new Date(NOW - 30 * HOUR).toISOString() }), NOW);
    expect(v.health).toBe('SILENT');
    expect(v.hoursSinceLastIngest).toBe(30);
  });

  it('distinguishes a source that has never received anything', () => {
    expect(assess(source({ lastIngestedAt: null }), NOW).health).toBe('NEVER_RECEIVED');
  });

  // Without a stated cadence there is no expectation to violate, and guessing
  // one would alert on every source that is simply quiet by nature.
  it('does not monitor a source with no cadence configured', () => {
    expect(assess(source({ expectedCadenceHours: null }), NOW).health).toBe('NOT_MONITORED');
    expect(assess(source({ expectedCadenceHours: 0 }), NOW).health).toBe('NOT_MONITORED');
  });

  it('does not monitor a paused source, which is quiet on purpose', () => {
    const v = assess(source({ status: 'PAUSED', lastIngestedAt: new Date(NOW - 500 * HOUR).toISOString() }), NOW);
    expect(v.health).toBe('NOT_MONITORED');
  });

  it('flags the first check that finds a source silent', () => {
    const v = assess(source({
      lastIngestedAt: new Date(NOW - 30 * HOUR).toISOString(),
      healthStatus: 'HEALTHY',
    }), NOW);
    expect(v.newlySilent).toBe(true);
  });

  // Alerting keys off newlySilent, so a source that stays broken for a month
  // produces one message rather than one per check.
  it('does not re-flag a source already known to be silent', () => {
    const v = assess(source({
      lastIngestedAt: new Date(NOW - 300 * HOUR).toISOString(),
      healthStatus: 'SILENT',
    }), NOW);
    expect(v.health).toBe('SILENT');
    expect(v.newlySilent).toBe(false);
  });

  it('flags a never-received source once, then not again', () => {
    expect(assess(source({ lastIngestedAt: null, healthStatus: null }), NOW).newlySilent).toBe(true);
    expect(assess(source({ lastIngestedAt: null, healthStatus: 'NEVER_RECEIVED' }), NOW).newlySilent).toBe(false);
  });

  it('recovers to healthy once traffic resumes', () => {
    const v = assess(source({ healthStatus: 'SILENT', lastIngestedAt: new Date(NOW - 1 * HOUR).toISOString() }), NOW);
    expect(v.health).toBe('HEALTHY');
    expect(v.newlySilent).toBe(false);
  });

  it('treats an unreadable timestamp as no traffic rather than throwing', () => {
    expect(assess(source({ lastIngestedAt: 'not-a-date' }), NOW).health).toBe('SILENT');
  });
});
