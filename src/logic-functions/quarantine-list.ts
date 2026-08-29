import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { coreApi } from '../lib/rest-client';

type QuarantinedLog = {
  id: string;
  status: string;
  spamScore: number | null;
  quarantineReason: string | null;
  rawPayload: string | null;
  processedAt: string | null;
  intakeSourceId: string | null;
};

/**
 * What is being held, and why.
 *
 * A quarantine nobody can see is just a slower way of losing leads, so the
 * reason and the score come back alongside a preview of the payload — enough to
 * recognise a real customer without opening the log record by hand.
 */
const handler = async (params: RoutePayload) => {
  const query = (params.queryParameters ?? {}) as Record<string, string | undefined>;
  const limit = clamp(parseInt(query['limit'] ?? '50', 10), 1, 200);
  const status = query['status'] === 'DISCARDED' ? 'DISCARDED' : 'QUARANTINED';

  try {
    const res = await coreApi.get<{ data: { intakeLogs: { edges: Array<{ node: QuarantinedLog }> } } }>(
      `/intakeLogs?filter=status[eq]:${status}&orderBy=processedAt[DescNullsLast]&limit=${limit}`,
    );

    const logs = (res.data?.intakeLogs?.edges ?? []).map((e) => e.node);

    return {
      statusCode: 200,
      body: {
        status,
        count: logs.length,
        logs: logs.map((log) => ({
          id: log.id,
          spamScore: log.spamScore,
          reason: log.quarantineReason,
          processedAt: log.processedAt,
          intakeSourceId: log.intakeSourceId,
          payloadPreview: preview(log.rawPayload),
          canRelease: Boolean(log.rawPayload),
        })),
      },
    };
  } catch (e) {
    return { statusCode: 500, body: { error: `Could not read quarantine: ${String(e)}` } };
  }
};

/**
 * A few identifying fields rather than the whole body — enough to judge, without
 * putting every stored payload into one response.
 */
function preview(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(parsed).slice(0, 12);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const value = parsed[key];
      out[key] = typeof value === 'string' && value.length > 200
        ? `${value.slice(0, 200)}…`
        : value;
    }
    return out;
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export default defineLogicFunction({
  universalIdentifier: IDS.QUARANTINE_LIST_LOGIC_FUNCTION,
  name: 'intake-quarantine-list',
  description: 'List payloads the spam filter is holding, with the reason each was held.',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/quarantine',
    httpMethod: 'GET',
    isAuthRequired: true,
  },
});
