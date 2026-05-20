import { defineApplication } from 'twenty-sdk/define';
import defaultRole from './default-role';
import { IDS } from './constants/universal-identifiers';

export const APPLICATION_UNIVERSAL_IDENTIFIER = IDS.APPLICATION;

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  name: 'twenty-app-intake',
  displayName: 'Intake',
  description:
    'Receive leads from any source — contact forms, pipeline apps, or any platform — and automatically normalize, classify, and ingest them into Twenty as clean records. Zero manual field configuration required.',
  category: 'data',
  logoUrl: 'https://raw.githubusercontent.com/your-org/twenty-app-intake/main/public/logo.png',
  websiteUrl: 'https://github.com/your-org/twenty-app-intake',
  defaultRoleUniversalIdentifier: defaultRole.universalIdentifier,
  applicationVariables: {
    INTAKE_FIELD_CREATION_ENABLED: {
      universalIdentifier: '3f4e8f8b-12aa-4c86-95b3-1a6620102a9d',
      value: 'true',
      description: 'Auto-create custom fields when unknown keys appear in a payload. Set to false to disable schema extension and route unknown fields to the note instead.',
    },
    INTAKE_MAX_EXT_FIELDS: {
      universalIdentifier: '0978faf5-37d5-4287-a2c9-b4069cb17e38',
      value: '50',
      description: 'Maximum number of custom ext fields allowed per object before additional unknown fields are forced into the note. Prevents schema bloat.',
    },
    INTAKE_DEFAULT_OPP_STAGE: {
      universalIdentifier: 'd0404ff9-abe1-4a4e-a8d3-b240600dd77d',
      value: 'NEW',
      description: 'Stage assigned to auto-created Opportunities. Must match an existing stage value in your workspace (e.g. NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER).',
    },
    INTAKE_DEDUP_WINDOW_MINUTES: {
      universalIdentifier: '55afed19-0d39-4c60-8955-35af5e883c39',
      value: '5',
      description: 'How many minutes to suppress duplicate payloads with the same content hash. Set to 0 to disable deduplication.',
    },
    INTAKE_REQUIRE_HMAC: {
      universalIdentifier: 'a2f575a1-8e11-4517-87c7-df45ff165951',
      value: 'false',
      description: 'When true, every source must have a webhook secret configured and all requests must be signed. Unsigned requests are rejected with 401.',
    },
    INTAKE_APP_LABEL: {
      universalIdentifier: 'b3e6a2d8-9f1c-4b5e-8d7a-2c4f6e8b0a1d',
      value: 'Intake',
      description: 'Display name used in generated content — note titles, opportunity names, and system messages. Change to match your team\'s terminology (e.g. "Leads", "Inbound", "Pipeline").',
    },
  },
});
