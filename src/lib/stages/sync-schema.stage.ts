import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import type { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { retry, handleAll, ExponentialBackoff } from 'cockatiel';

const STANDARD_OBJECTS = new Set(['name', 'emails', 'phones', 'domainName', 'address',
  'linkedInLink', 'xLink', 'companyName', 'firstName', 'lastName', 'fullName']);

export class SyncSchemaStage implements PipelineStage {
  readonly name = 'sync-schema';

  private readonly objectMetaCache = new Map<
    string,
    { id: string; fields: Set<string>; fetchedAt: number }
  >();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private readonly retryPolicy = retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({ initialDelay: 200, exponent: 2 }),
  });

  constructor(private readonly metadataClient: MetadataApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    if (!ctx.crmFields || ctx.crmFields.length === 0) return ok(ctx);

    // Determine which objects we need to extend
    const targetObjects = this.getTargetObjects(ctx);
    let fieldsCreated = 0;
    let fieldsMatched = 0;

    for (const objectName of targetObjects) {
      const meta = await this.getObjectMeta(objectName);
      if (!meta) continue;

      for (const field of ctx.crmFields) {
        if (STANDARD_OBJECTS.has(field.canonicalName)) {
          fieldsMatched++;
          continue;
        }

        if (meta.fields.has(field.canonicalName)) {
          fieldsMatched++;
          continue;
        }

        // New field — create it via Metadata API
        const created = await this.createField(meta.id, field.canonicalName, field.twentyType, objectName);
        if (created) {
          meta.fields.add(field.canonicalName);
          fieldsCreated++;
        } else {
          ctx.warnings.push(`Could not create field "${field.canonicalName}" on ${objectName}`);
        }
      }
    }

    return ok({ ...ctx, fieldsCreated, fieldsMatched });
  }

  private getTargetObjects(ctx: PipelineContext): string[] {
    const target = ctx.source?.targetObject ?? 'AUTO';
    if (target === 'PERSON') return ['person'];
    if (target === 'COMPANY') return ['company'];
    // AUTO — check what data we have
    const hasPersonData = ctx.crmFields?.some((f) =>
      ['firstName', 'lastName', 'email', 'phone', 'fullName'].includes(f.canonicalName),
    );
    const hasCompanyData = ctx.crmFields?.some((f) =>
      ['companyName', 'domainName'].includes(f.canonicalName),
    );
    const objects: string[] = [];
    if (hasPersonData) objects.push('person');
    if (hasCompanyData) objects.push('company');
    return objects.length > 0 ? objects : ['person'];
  }

  private async getObjectMeta(
    objectName: string,
  ): Promise<{ id: string; fields: Set<string> } | null> {
    const cached = this.objectMetaCache.get(objectName);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached;
    }

    try {
      const result = await this.metadataClient.query({
        objects: {
          __args: { filter: { nameSingular: { eq: objectName } } },
          edges: {
            node: {
              id: true,
              nameSingular: true,
              fields: {
                edges: { node: { name: true } },
              },
            },
          },
        },
      });

      const node = result.objects?.edges?.[0]?.node;
      if (!node) return null;

      const fieldNames = new Set<string>(
        (node.fields?.edges ?? []).map((e: { node: { name: string } }) => e.node.name),
      );

      const meta = { id: node.id, fields: fieldNames, fetchedAt: Date.now() };
      this.objectMetaCache.set(objectName, meta);
      return meta;
    } catch {
      return null;
    }
  }

  private async createField(
    objectMetadataId: string,
    name: string,
    type: string,
    objectName: string,
  ): Promise<boolean> {
    try {
      await this.retryPolicy.execute(() =>
        this.metadataClient.mutation({
          createOneField: {
            __args: {
              input: {
                field: {
                  objectMetadataId,
                  name,
                  label: toLabel(name),
                  type,
                  description: `Auto-created by Intake from "${objectName}" payload`,
                  icon: 'IconPlug',
                },
              },
            },
            id: true,
          },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

function toLabel(name: string): string {
  return name
    .replace(/^ext_/, '')
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}
