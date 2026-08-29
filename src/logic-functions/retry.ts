import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { loadLog, slugForSource } from '../lib/replay';
import { runIngestion, successBody } from '../lib/ingest';

/**
 * Re-run a failed ingestion.
 *
 * Deliberately narrower than replay: this refuses a log that already succeeded,
 * so an operator clicking Retry on a working record cannot create a second one.
 * Use `/replay` for a log that succeeded but needs re-mapping.
 */
const handler = async (params: RoutePayload) => {
  const startedAt = Date.now();

  const logId = params.pathParameters?.['logId'];
  if (!logId) return { statusCode: 400, body: { error: 'Missing logId in URL' } };

  const log = await loadLog(logId);
  if (!log) return { statusCode: 404, body: { error: `IntakeLog ${logId} not found` } };

  if (log.status === 'SUCCESS') {
    return {
      statusCode: 400,
      body: {
        error: 'This ingestion already succeeded — no retry needed. Use POST /s/intake/logs/:logId/replay to re-run it through the current rules.',
        status: log.status,
      },
    };
  }

  if (log.status === 'QUARANTINED') {
    return {
      statusCode: 400,
      body: {
        error: 'This payload is quarantined. Use POST /s/intake/quarantine/:logId/release to let it through.',
        status: log.status,
      },
    };
  }

  if (!log.rawPayload) {
    return {
      statusCode: 400,
      body: {
        error: 'No raw payload stored on this log — retry needs one. Check INTAKE_RAW_PAYLOAD_RETENTION and INTAKE_RAW_PAYLOAD_MAX_BYTES.',
        code: 'NO_STORED_PAYLOAD',
      },
    };
  }

  let rawPayload: Record<string, unknown>;
  try {
    rawPayload = JSON.parse(log.rawPayload) as Record<string, unknown>;
  } catch {
    return { statusCode: 400, body: { error: 'rawPayload is not valid JSON' } };
  }

  const sourceSlug = await slugForSource(log.intakeSourceId);
  if (!sourceSlug) {
    return { statusCode: 400, body: { error: 'The source for this log no longer exists' } };
  }

  const outcome = await runIngestion({
    sourceSlug,
    rawPayload,
    // The signature was verified when the payload first arrived and there is no
    // body to re-verify against; the caller here is already authenticated.
    skipDedup: true,
    replayOfLogId: log.id,
  });

  if (!outcome.ok) {
    return {
      statusCode: 500,
      body: {
        error: `Retry failed: ${outcome.error.message}`,
        code: outcome.error.code,
        originalLogId: logId,
      },
    };
  }

  return {
    statusCode: 200,
    body: { originalLogId: logId, ...successBody(outcome.ctx, startedAt) },
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.RETRY_LOGIC_FUNCTION,
  name: 'intake-retry',
  description: 'Retry a failed ingestion using the stored raw payload from an IntakeLog record.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/logs/:logId/retry',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
