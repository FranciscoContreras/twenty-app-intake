import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { IDS } from '../constants/universal-identifiers';

const ALLOWED_TARGET_OBJECTS = ['PERSON', 'COMPANY', 'AUTO'] as const;

const handler = async (params: RoutePayload) => {
  const body = params.body as Record<string, unknown> | null;
  if (!body) return { statusCode: 400, body: { error: 'Missing request body' } };

  const name = body['name'] as string | undefined;
  const slug = body['slug'] as string | undefined;
  const targetObject = (body['targetObject'] as string | undefined) ?? 'AUTO';
  const createOpportunity = (body['createOpportunity'] as boolean | undefined) ?? true;
  const opportunityNameTemplate = (body['opportunityNameTemplate'] as string | undefined)
    ?? '{{source}} — {{firstName}} {{lastName}}';

  if (!name || !slug) {
    return { statusCode: 400, body: { error: 'name and slug are required' } };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { statusCode: 400, body: { error: 'slug must be lowercase letters, numbers, and hyphens only' } };
  }
  if (!ALLOWED_TARGET_OBJECTS.includes(targetObject as typeof ALLOWED_TARGET_OBJECTS[number])) {
    return { statusCode: 400, body: { error: 'targetObject must be PERSON, COMPANY, or AUTO' } };
  }

  const client = new CoreApiClient();

  // Check for existing source with same slug (idempotent registration)
  const existing = await client.query({
    intakeSources: {
      __args: { filter: { slug: { eq: slug } } },
      edges: { node: { id: true, slug: true } },
    },
  });

  const existingNode = existing.intakeSources?.edges?.[0]?.node;

  if (existingNode) {
    return {
      statusCode: 200,
      body: {
        id: existingNode.id,
        slug: existingNode.slug,
        webhookUrl: buildWebhookUrl(slug),
        message: 'Source already exists — returning existing registration.',
      },
    };
  }

  // Generate a signing secret
  const { webcrypto } = await import('node:crypto');
  const secretBytes = webcrypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  const created = await client.mutation({
    createIntakeSource: {
      __args: {
        data: {
          name,
          slug,
          targetObject,
          webhookSecret: secret,
          status: 'ACTIVE',
          createOpportunity,
          opportunityNameTemplate,
          totalIngested: 0,
          totalFailed: 0,
        },
      },
      id: true,
      slug: true,
    },
  });

  return {
    statusCode: 201,
    body: {
      id: created.createIntakeSource.id,
      slug: created.createIntakeSource.slug,
      webhookUrl: buildWebhookUrl(slug),
      secret,
      message: 'Source registered. Sign all requests with X-Webhook-Signature using the secret.',
    },
  };
};

function buildWebhookUrl(slug: string): string {
  const baseUrl = process.env['TWENTY_API_URL'] ?? 'https://your-crm.com';
  const appSlug = 'intake';
  return `${baseUrl}/s/${appSlug}/intake/${slug}`;
}

export default defineLogicFunction({
  universalIdentifier: IDS.REGISTER_LOGIC_FUNCTION,
  name: 'intake-register',
  description: 'Programmatically register a new Intake source and get back a webhook URL + signing secret.',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/sources/register',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
