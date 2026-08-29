/**
 * Noticing that nothing arrived.
 *
 * Every other failure in this app announces itself: a bad signature returns 401,
 * a rejected record writes a FAILED log. Silence returns nothing, logs nothing
 * and looks exactly like a quiet week. A form that breaks in February is found
 * in August, and the only evidence is leads that were never there.
 *
 * The check is deliberately small. A source states how long it may go quiet;
 * anything longer is a fault, recorded on the source and posted once to a
 * webhook if one is configured. There is no scheduler here — a Twenty App has
 * nowhere dependable to run one — so the endpoint is driven by whatever already
 * pings on a timer, which for most workspaces is an uptime monitor they have.
 */

import { coreApi } from './rest-client';

export type SourceHealth = {
  id: string;
  name: string;
  slug: string;
  status: string;
  expectedCadenceHours: number | null;
  lastIngestedAt: string | null;
  healthStatus: string | null;
  silentSince: string | null;
  lastAlertAt: string | null;
  alertWebhookUrl: string | null;
};

export type SilenceVerdict = {
  slug: string;
  name: string;
  health: 'HEALTHY' | 'SILENT' | 'NEVER_RECEIVED' | 'NOT_MONITORED';
  hoursSinceLastIngest: number | null;
  expectedCadenceHours: number | null;
  /** True the first time a source is seen silent, which is when alerting fires. */
  newlySilent: boolean;
};

const HOUR_MS = 60 * 60 * 1000;

export function assess(source: SourceHealth, now = Date.now()): SilenceVerdict {
  const base = {
    slug: source.slug,
    name: source.name,
    expectedCadenceHours: source.expectedCadenceHours,
  };

  // A paused source is quiet because someone made it quiet.
  if (source.status === 'PAUSED' || !source.expectedCadenceHours || source.expectedCadenceHours <= 0) {
    return { ...base, health: 'NOT_MONITORED', hoursSinceLastIngest: hoursSince(source.lastIngestedAt, now), newlySilent: false };
  }

  const wasSilent = source.healthStatus === 'SILENT' || source.healthStatus === 'NEVER_RECEIVED';

  if (!source.lastIngestedAt) {
    // A source that has never received anything is a different problem from one
    // that stopped: usually the webhook was never wired up on the sending side.
    return { ...base, health: 'NEVER_RECEIVED', hoursSinceLastIngest: null, newlySilent: !wasSilent };
  }

  const hours = hoursSince(source.lastIngestedAt, now);

  // A timestamp we cannot read must not be rounded down to "arrived just now" —
  // that is a source reporting healthy forever, which is the exact failure this
  // check exists to catch. Unreadable counts as silent.
  if (hours === null || hours > source.expectedCadenceHours) {
    return { ...base, health: 'SILENT', hoursSinceLastIngest: hours, newlySilent: !wasSilent };
  }

  return { ...base, health: 'HEALTHY', hoursSinceLastIngest: hours, newlySilent: false };
}

function hoursSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.round(((now - then) / HOUR_MS) * 10) / 10;
}

export async function loadSources(): Promise<SourceHealth[]> {
  try {
    const res = await coreApi.get<{ data: { intakeSources: { edges: Array<{ node: SourceHealth }> } } }>(
      '/intakeSources?limit=200',
    );
    return (res.data?.intakeSources?.edges ?? []).map((e) => e.node);
  } catch {
    return [];
  }
}

/**
 * Write the verdict back to the source.
 *
 * `silentSince` is only stamped on the transition, so it keeps meaning "when we
 * first noticed" rather than sliding forward on every check.
 */
export async function persist(source: SourceHealth, verdict: SilenceVerdict): Promise<void> {
  if (verdict.health === 'NOT_MONITORED') return;
  if (source.healthStatus === verdict.health && !verdict.newlySilent) return;

  const patch: Record<string, unknown> = { healthStatus: verdict.health };
  if (verdict.health === 'HEALTHY') {
    patch['silentSince'] = null;
  } else if (verdict.newlySilent) {
    patch['silentSince'] = new Date().toISOString();
  }

  await coreApi.patch(`/intakeSources/${source.id}`, patch).catch(() => null);
}

/**
 * Post one alert.
 *
 * Fired only on the transition into silence, so a source that stays broken for a
 * month produces one message rather than one per check — an alert channel that
 * repeats itself is an alert channel people mute.
 */
export async function sendAlert(source: SourceHealth, verdict: SilenceVerdict): Promise<boolean> {
  if (!source.alertWebhookUrl || !verdict.newlySilent) return false;

  const text = verdict.health === 'NEVER_RECEIVED'
    ? `Intake: source "${source.name}" (${source.slug}) has never received a payload, and a cadence of ${verdict.expectedCadenceHours}h is configured. The sending side is probably not wired up.`
    : `Intake: source "${source.name}" (${source.slug}) has received nothing for ${verdict.hoursSinceLastIngest}h, past its expected cadence of ${verdict.expectedCadenceHours}h.`;

  try {
    const res = await fetch(source.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` is what Slack, Discord and Teams incoming webhooks all read, so
      // the common case needs no transformation; the rest is there for anything
      // consuming the payload properly.
      body: JSON.stringify({
        text,
        source: { slug: source.slug, name: source.name },
        health: verdict.health,
        hoursSinceLastIngest: verdict.hoursSinceLastIngest,
        expectedCadenceHours: verdict.expectedCadenceHours,
      }),
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }

  await coreApi.patch(`/intakeSources/${source.id}`, {
    lastAlertAt: new Date().toISOString(),
  }).catch(() => null);

  return true;
}
