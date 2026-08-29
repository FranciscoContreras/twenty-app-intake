import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { runIngestion, statusCodeFor, idempotencyKeyFrom, successBody } from '../lib/ingest';

const handler = async (params: RoutePayload) => {
  const startedAt = Date.now();

  const sourceSlug = params.pathParameters?.['slug'];
  if (!sourceSlug) {
    return { statusCode: 400, body: { error: 'Missing source slug in URL', code: 'INVALID_PAYLOAD' } };
  }

  let rawPayload: Record<string, unknown> = {};
  if (params.body && typeof params.body === 'object' && !Array.isArray(params.body)) {
    rawPayload = params.body as Record<string, unknown>;
  }

  const headers = (params.headers ?? {}) as Record<string, string | undefined>;

  const outcome = await runIngestion({
    sourceSlug,
    rawPayload,
    rawBody: params.rawBody,
    headers,
    idempotencyKey: idempotencyKeyFrom(headers, rawPayload),
  });

  if (!outcome.ok) {
    const { code, message, details } = outcome.error;

    // A held payload is not an error the sender can act on, and telling a bot
    // which submissions were caught only teaches it what to change.
    if (code === 'QUARANTINED') {
      return { statusCode: 202, body: { success: true, status: 'held_for_review' } };
    }

    return {
      statusCode: statusCodeFor(code),
      body: { error: message, code, ...(details ? { details } : {}) },
    };
  }

  return { statusCode: 200, body: successBody(outcome.ctx, startedAt) };
};

export default defineLogicFunction({
  universalIdentifier: IDS.WEBHOOK_LOGIC_FUNCTION,
  name: 'intake-webhook',
  description: 'Receives lead payloads from any source and ingests them into Twenty CRM.',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/:slug',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-webhook-signature', 'x-intake-source', 'content-type', 'idempotency-key'],
  },
});
