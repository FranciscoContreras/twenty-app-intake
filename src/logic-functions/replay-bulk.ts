import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { selectLogs, replayLog, type ReplayResult } from '../lib/replay';
import { replayMaxBatch } from '../lib/settings';

/**
 * Replay a batch of stored payloads.
 *
 * Sequential on purpose. Each replay writes to the CRM and creates schema, and
 * firing a batch of them concurrently at the same person or company would race
 * the dedup lookup against itself and produce exactly the duplicates this app
 * exists to prevent.
 */
const handler = async (params: RoutePayload) => {
  const body = (params.body ?? {}) as Record<string, unknown>;

  const dryRun = body['dryRun'] === true;
  const logs = await selectLogs({
    sourceSlug: asString(body['sourceSlug']),
    status: asString(body['status']),
    since: asString(body['since']),
    until: asString(body['until']),
    limit: typeof body['limit'] === 'number' ? body['limit'] : undefined,
  });

  if (logs.length === 0) {
    return {
      statusCode: 200,
      body: { success: true, matched: 0, replayed: 0, failed: 0, results: [], message: 'No logs matched the selection.' },
    };
  }

  // A batch this size is about to write to the CRM once per log. Saying what it
  // would touch, without touching it, is the cheap half of the safety gate.
  if (dryRun) {
    return {
      statusCode: 200,
      body: {
        dryRun: true,
        matched: logs.length,
        maxBatch: replayMaxBatch(),
        replayable: logs.filter((l) => l.rawPayload).length,
        missingPayload: logs.filter((l) => !l.rawPayload).map((l) => l.id),
        logIds: logs.map((l) => l.id),
      },
    };
  }

  const results: ReplayResult[] = [];
  for (const log of logs) {
    results.push(await replayLog(log));
  }

  const replayed = results.filter((r) => r.ok).length;

  return {
    statusCode: 200,
    body: {
      success: true,
      matched: logs.length,
      replayed,
      failed: results.length - replayed,
      results,
    },
  };
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export default defineLogicFunction({
  universalIdentifier: IDS.REPLAY_BULK_LOGIC_FUNCTION,
  name: 'intake-replay-bulk',
  description: 'Re-run a batch of stored payloads through the current field rules.',
  timeoutSeconds: 300,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/replay',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
