import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { IDS } from '../constants/universal-identifiers';
import { createPipeline } from '../lib/pipeline-factory';
import type { PipelineContext } from '../lib/pipeline';
import { coreApi } from '../lib/rest-client';

const handler = async (params: RoutePayload) => {
  const logId = params.pathParameters?.['logId'];
  if (!logId) {
    return { statusCode: 400, body: { error: 'Missing logId in URL' } };
  }

  // Fetch the existing log
  const logResult = await coreApi.get<{
    data: {
      intakeLog: {
        id: string;
        status: string;
        rawPayload: string | null;
        intakeSourceId: string | null;
        error: string | null;
      };
    };
  }>(`/intakeLogs/${logId}`).catch(() => null);

  const log = logResult?.data?.intakeLog;

  if (!log) {
    return { statusCode: 404, body: { error: `IntakeLog ${logId} not found` } };
  }

  if (log.status === 'SUCCESS') {
    return {
      statusCode: 400,
      body: { error: 'This ingestion already succeeded — no retry needed', status: log.status },
    };
  }

  if (!log.rawPayload) {
    return {
      statusCode: 400,
      body: { error: 'No raw payload stored on this log — retry requires rawPayload field (logs created in v0.2.0+)' },
    };
  }

  let rawPayload: Record<string, unknown>;
  try {
    rawPayload = JSON.parse(log.rawPayload);
  } catch {
    return { statusCode: 400, body: { error: 'rawPayload is not valid JSON' } };
  }

  // We need a sourceSlug to run the pipeline — get it from the source record
  let sourceSlug = 'unknown';
  if (log.intakeSourceId) {
    const srcResult = await coreApi.get<{ data: { intakeSource: { slug: string } } }>(
      `/intakeSources/${log.intakeSourceId}`,
    ).catch(() => null);
    sourceSlug = srcResult?.data?.intakeSource?.slug ?? 'unknown';
  }

  const startedAt = Date.now();
  const coreClient = new CoreApiClient();
  const metadataClient = new MetadataApiClient();
  const pipeline = createPipeline(coreClient, metadataClient);

  const ctx: PipelineContext = {
    sourceSlug,
    rawBody: undefined, // HMAC skipped on retry — source already verified originally
    rawPayload,
    headers: {},
    startedAt,
    skipDedup: true, // Critical — bypass idempotency so the payload re-runs
    fieldsCreated: 0,
    fieldsMatched: 0,
    warnings: [],
    events: [],
  };

  const result = await pipeline.run(ctx);

  if (!result.ok) {
    return {
      statusCode: 500,
      body: {
        error: `Retry failed: ${result.error.message}`,
        code: result.error.code,
        originalLogId: logId,
      },
    };
  }

  const { value: finalCtx } = result;

  return {
    statusCode: 200,
    body: {
      success: true,
      originalLogId: logId,
      recordId: finalCtx.personId ?? finalCtx.companyId,
      recordType: finalCtx.recordType,
      personId: finalCtx.personId,
      companyId: finalCtx.companyId,
      fieldsCreated: finalCtx.fieldsCreated,
      processingMs: Date.now() - startedAt,
      warnings: finalCtx.warnings,
    },
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
