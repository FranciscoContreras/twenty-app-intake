import { defineLogicFunction } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { loadSources, assess, persist, sendAlert } from '../lib/silence';

/**
 * Evaluate every source's cadence, record the verdict, alert on new silences.
 *
 * Meant to be called on a timer by something that already exists — an uptime
 * monitor, a cron job, a Twenty workflow. Calling it more often than the
 * shortest configured cadence costs nothing: the transition test means repeat
 * calls are idempotent and only the first one alerts.
 */
const handler = async () => {
  const sources = await loadSources();
  const verdicts = [];
  let alertsSent = 0;

  for (const source of sources) {
    const verdict = assess(source);
    await persist(source, verdict);
    if (await sendAlert(source, verdict)) alertsSent++;
    verdicts.push(verdict);
  }

  const silent = verdicts.filter((v) => v.health === 'SILENT' || v.health === 'NEVER_RECEIVED');

  return {
    statusCode: 200,
    body: {
      checkedAt: new Date().toISOString(),
      sourcesChecked: sources.length,
      monitored: verdicts.filter((v) => v.health !== 'NOT_MONITORED').length,
      silentCount: silent.length,
      alertsSent,
      silent,
      sources: verdicts,
    },
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.CHECK_SILENCE_LOGIC_FUNCTION,
  name: 'intake-check-silence',
  description: 'Check every source against its expected cadence and alert on sources that have fallen silent.',
  timeoutSeconds: 60,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/sources/check-silence',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
