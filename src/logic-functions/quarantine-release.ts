import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { coreApi } from '../lib/rest-client';
import { loadLog, slugForSource } from '../lib/replay';
import { runIngestion } from '../lib/ingest';

/**
 * Let a held payload through.
 *
 * The scoring still runs and is still recorded — the release is a human
 * overruling a judgement, and the log should show both. The original log is
 * marked FAILED rather than deleted, because the record of what was held and
 * who let it through is the part that makes the filter safe to trust.
 */
const handler = async (params: RoutePayload) => {
  const logId = params.pathParameters?.['logId'];
  if (!logId) return { statusCode: 400, body: { error: 'Missing logId in URL' } };

  const log = await loadLog(logId);
  if (!log) return { statusCode: 404, body: { error: `IntakeLog ${logId} not found` } };

  if (log.status !== 'QUARANTINED') {
    return {
      statusCode: 400,
      body: { error: `Log ${logId} is ${log.status}, not QUARANTINED — nothing to release`, status: log.status },
    };
  }

  if (!log.rawPayload) {
    return {
      statusCode: 400,
      body: {
        error: 'No stored payload — this log cannot be released. Set INTAKE_RAW_PAYLOAD_RETENTION=FULL to keep payloads for review.',
        code: 'NO_STORED_PAYLOAD',
      },
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(log.rawPayload) as Record<string, unknown>;
  } catch {
    return { statusCode: 400, body: { error: 'Stored payload is not valid JSON' } };
  }

  const slug = await slugForSource(log.intakeSourceId);
  if (!slug) return { statusCode: 400, body: { error: 'The source for this log no longer exists' } };

  const outcome = await runIngestion({
    sourceSlug: slug,
    rawPayload: payload,
    skipDedup: true,
    skipSpamFilter: true,
    replayOfLogId: log.id,
  });

  if (!outcome.ok) {
    return {
      statusCode: 500,
      body: { error: `Release failed: ${outcome.error.message}`, code: outcome.error.code, logId },
    };
  }

  await coreApi.patch(`/intakeLogs/${logId}`, {
    status: 'FAILED',
    error: 'Released from quarantine — see the log created by the release for the result',
  }).catch(() => null);

  return {
    statusCode: 200,
    body: {
      success: true,
      releasedLogId: logId,
      recordId: outcome.ctx.personId ?? outcome.ctx.companyId,
      personId: outcome.ctx.personId,
      companyId: outcome.ctx.companyId,
      opportunityId: outcome.ctx.opportunityId,
      warnings: outcome.ctx.warnings,
    },
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.QUARANTINE_RELEASE_LOGIC_FUNCTION,
  name: 'intake-quarantine-release',
  description: 'Release a quarantined payload and ingest it, overruling the spam filter.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/quarantine/:logId/release',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
