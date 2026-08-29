import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { IDS } from '../constants/universal-identifiers';
import { APP_VERSION } from '../constants/version';
import { loadSources, assess } from '../lib/silence';

/**
 * Health, plus the sources that have gone quiet.
 *
 * The existing `status` and `timestamp` keys and the 200/503 behaviour are
 * untouched, because monitors are already pointed at this and an upgrade must
 * not start paging anyone. The silence summary is added alongside, and only
 * changes the status code when the caller asks for it with `?strict=true` —
 * which is the form to point a monitor at if you want a dead form to page you.
 */
const handler = async (params: RoutePayload) => {
  const strict = (params.queryParameters ?? {})['strict'] === 'true';

  try {
    const client = new CoreApiClient();
    await client.query({ intakeSources: { edges: { node: { id: true } } } });

    const verdicts = (await loadSources()).map((s) => assess(s));
    const silent = verdicts.filter((v) => v.health === 'SILENT' || v.health === 'NEVER_RECEIVED');

    return {
      statusCode: strict && silent.length > 0 ? 503 : 200,
      body: {
        status: strict && silent.length > 0 ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        sources: {
          total: verdicts.length,
          monitored: verdicts.filter((v) => v.health !== 'NOT_MONITORED').length,
          silent: silent.length,
          silentSources: silent.map((v) => ({
            slug: v.slug,
            name: v.name,
            health: v.health,
            hoursSinceLastIngest: v.hoursSinceLastIngest,
            expectedCadenceHours: v.expectedCadenceHours,
          })),
        },
      },
    };
  } catch (e) {
    return { statusCode: 503, body: { status: 'error', message: String(e) } };
  }
};

export default defineLogicFunction({
  universalIdentifier: IDS.HEALTH_LOGIC_FUNCTION,
  name: 'intake-health',
  description: 'Health check for the Intake app, including sources that have fallen silent.',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/health',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
