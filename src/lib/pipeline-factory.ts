import type { CoreApiClient } from 'twenty-client-sdk/core';
import type { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { Pipeline } from './pipeline';
import { LoadSourceStage } from './stages/load-source.stage';
import { VerifySignatureStage } from './stages/verify-signature.stage';
import { IdempotencyStage } from './stages/idempotency.stage';
import { FlattenStage } from './stages/flatten.stage';
import { NormalizeStage } from './stages/normalize.stage';
import { SyncSchemaStage } from './stages/sync-schema.stage';
import { UpsertRecordStage } from './stages/upsert-record.stage';
import { WriteLogStage } from './stages/write-log.stage';

/**
 * Assemble the 8-stage ingestion pipeline.
 *
 * Stage order is intentional:
 *  1. LoadSource        — resolve source config (needed by all later stages)
 *  2. VerifySignature   — auth check (needs source's webhookSecret)
 *  3. Idempotency       — dedup before any expensive work
 *  4. Flatten           — normalise nested structure to flat record
 *  5. Normalize         — map field names, detect types
 *  6. SyncSchema        — create missing fields in Twenty via Metadata API
 *  7. UpsertRecord      — create/update Person, Company, Opportunity, Note
 *  8. WriteLog          — persist IntakeLog (always runs, even on partial)
 */
export function createPipeline(
  coreClient: CoreApiClient,
  metadataClient: MetadataApiClient,
): Pipeline {
  return new Pipeline()
    .use(new LoadSourceStage(coreClient))
    .use(new VerifySignatureStage())
    .use(new IdempotencyStage(coreClient))
    .use(new FlattenStage())
    .use(new NormalizeStage(coreClient))
    .use(new SyncSchemaStage(metadataClient))
    .use(new UpsertRecordStage(coreClient))
    .use(new WriteLogStage(coreClient));
}
