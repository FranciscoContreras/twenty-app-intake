import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { loadLog, replayLog } from '../lib/replay';

/**
 * Re-run one stored payload through the rules as they are now.
 *
 * Unlike retry this accepts a log that already succeeded, which is the case that
 * matters: the ingestion worked, a mapping was added afterwards, and the record
 * needs to be brought up to date from the payload rather than by hand.
 */
const handler = async (params: RoutePayload) => {
  const logId = params.pathParameters?.['logId'];
  if (!logId) return { statusCode: 400, body: { error: 'Missing logId in URL' } };

  const log = await loadLog(logId);
  if (!log) return { statusCode: 404, body: { error: `IntakeLog ${logId} not found` } };

  const result = await replayLog(log);

  if (!result.ok) {
    return {
      statusCode: result.reason?.startsWith('No stored payload') ? 400 : 500,
      body: { error: result.reason, logId, code: 'REPLAY_FAILED' },
    };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      replayedLogId: logId,
      recordId: result.recordId,
      personId: result.personId,
      companyId: result.companyId,
      opportunityId: result.opportunityId,
      fieldsCreated: result.fieldsCreated,
      warnings: result.warnings,
    },
  };
};

export default defineLogicFunction({
  universalIdentifier: IDS.REPLAY_LOG_LOGIC_FUNCTION,
  name: 'intake-replay-log',
  description: 'Re-run a single stored payload through the current field rules.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/logs/:logId/replay',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
