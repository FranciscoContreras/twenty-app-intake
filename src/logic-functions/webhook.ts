import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { IDS } from '../constants/universal-identifiers';
import { createPipeline } from '../lib/pipeline-factory';
import type { PipelineContext } from '../lib/pipeline';

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

  const coreClient = new CoreApiClient();
  const metadataClient = new MetadataApiClient();
  const pipeline = createPipeline(coreClient, metadataClient);

  const ctx: PipelineContext = {
    sourceSlug,
    rawBody: params.rawBody,
    rawPayload,
    headers: (params.headers ?? {}) as Record<string, string | undefined>,
    startedAt,
    fieldsCreated: 0,
    fieldsMatched: 0,
    warnings: [],
    events: [],
  };

  const result = await pipeline.run(ctx);

  if (!result.ok) {
    const { code, message } = result.error;
    const statusCode =
      code === 'INVALID_SIGNATURE' ? 401
      : code === 'SOURCE_NOT_FOUND' ? 404
      : code === 'SOURCE_PAUSED' ? 423
      : code === 'DUPLICATE_PAYLOAD' ? 200
      : 500;

    return { statusCode, body: { error: message, code } };
  }

  const { value: finalCtx } = result;

  return {
    statusCode: 200,
    body: {
      success: true,
      recordId: finalCtx.personId ?? finalCtx.companyId,
      recordType: finalCtx.recordType,
      personId: finalCtx.personId,
      companyId: finalCtx.companyId,
      opportunityId: finalCtx.opportunityId,
      fieldsCreated: finalCtx.fieldsCreated,
      fieldsMatched: finalCtx.fieldsMatched,
      overflowCount: finalCtx.noteFields?.length ?? 0,
      processingMs: Date.now() - startedAt,
      warnings: finalCtx.warnings,
    },
  };
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
    forwardedRequestHeaders: ['x-webhook-signature', 'x-intake-source', 'content-type'],
  },
});
