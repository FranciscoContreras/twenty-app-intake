import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { coreApi } from '../lib/rest-client';
import { loadLog } from '../lib/replay';

/**
 * Mark a held payload as junk.
 *
 * The log is marked DISCARDED, not deleted. Keeping it is what lets the filter
 * be judged later — a run of discards is evidence the threshold is right, and a
 * discard sitting next to a release is evidence it is not. Deleting the row
 * would throw away the only record of how well the thing is working.
 *
 * `purgePayload` drops the stored body while keeping the row, for anyone who
 * would rather not retain the contents of obvious spam.
 */
const handler = async (params: RoutePayload) => {
  const logId = params.pathParameters?.['logId'];
  if (!logId) return { statusCode: 400, body: { error: 'Missing logId in URL' } };

  const body = (params.body ?? {}) as Record<string, unknown>;
  const purgePayload = body['purgePayload'] === true;

  const log = await loadLog(logId);
  if (!log) return { statusCode: 404, body: { error: `IntakeLog ${logId} not found` } };

  if (log.status !== 'QUARANTINED') {
    return {
      statusCode: 400,
      body: { error: `Log ${logId} is ${log.status}, not QUARANTINED — nothing to discard`, status: log.status },
    };
  }

  try {
    await coreApi.patch(`/intakeLogs/${logId}`, {
      status: 'DISCARDED',
      ...(purgePayload ? { rawPayload: null } : {}),
    });
  } catch (e) {
    return { statusCode: 500, body: { error: `Could not discard log: ${String(e)}` } };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      logId,
      status: 'DISCARDED',
      payloadPurged: purgePayload,
    },
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.QUARANTINE_DISCARD_LOGIC_FUNCTION,
  name: 'intake-quarantine-discard',
  description: 'Mark a quarantined payload as junk, optionally purging the stored body.',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/quarantine/:logId/discard',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
