import { defineApplication } from 'twenty-sdk/define';
import { IDS } from './constants/universal-identifiers';
import postInstall from './post-install';

export const APPLICATION_UNIVERSAL_IDENTIFIER = IDS.APPLICATION;

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  name: 'twenty-app-intake',
  displayName: 'Intake',
  description:
    'The missing ingestion layer for Twenty CRM. Wire any contact form, pipeline app, or webhook source to Twenty — fields normalize automatically, schema extends on the fly, duplicates never land twice.',
  category: 'Data',
  logo: 'public/logo.svg',
  websiteUrl: 'https://github.com/FranciscoContreras/twenty-app-intake',
  author: 'Machina (https://wearemachina.com)',
  issueReportUrl: 'https://github.com/FranciscoContreras/twenty-app-intake/issues',
  postInstallLogicFunction: {
    universalIdentifier: postInstall.universalIdentifier,
    shouldRunSynchronously: true,
  },
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
    INTAKE_MERGE_POLICY: {
      universalIdentifier: IDS.VAR_MERGE_POLICY,
      value: 'PRESERVE',
      description: 'What an update does to a field that already holds a value. PRESERVE fills blanks and leaves everything else alone. NEWEST_WINS lets the incoming payload overwrite, which is how versions before 0.4.0 behaved. A blank value in a payload never overwrites under either setting.',
    },
    INTAKE_SPAM_FILTER_ENABLED: {
      universalIdentifier: IDS.VAR_SPAM_FILTER_ENABLED,
      value: 'false',
      description: 'Score inbound payloads and quarantine anything at or above the threshold. Off by default — turn it on after checking a few days of scores in the Intake Logs. Honeypot fields work whether or not this is on.',
    },
    INTAKE_SPAM_SCORE_THRESHOLD: {
      universalIdentifier: IDS.VAR_SPAM_SCORE_THRESHOLD,
      value: '5',
      description: 'Score at which a payload is held for review. Individual signals are worth 2 to 4 points, so the default needs two or more of them to agree before anything is withheld. Lower is stricter.',
    },
    INTAKE_HONEYPOT_FIELD: {
      universalIdentifier: IDS.VAR_HONEYPOT_FIELD,
      value: '',
      description: 'Name of a form field that is hidden from people. Any payload that arrives with it filled is quarantined. Empty disables it. A per-source Honeypot Field overrides this.',
    },
    INTAKE_RAW_PAYLOAD_RETENTION: {
      universalIdentifier: IDS.VAR_RAW_PAYLOAD_RETENTION,
      value: 'FULL',
      description: 'FULL stores each payload on its log, which is what makes retry and replay possible. NONE stores nothing and switches both off. Credentials (password, token, secret, card and similar keys) are stripped before storage either way.',
    },
    INTAKE_RAW_PAYLOAD_MAX_BYTES: {
      universalIdentifier: IDS.VAR_RAW_PAYLOAD_MAX_BYTES,
      value: '65000',
      description: 'Largest payload stored for replay. Anything bigger is processed normally but not kept, and the log says so — a truncated payload would not parse, so it is dropped rather than half-stored.',
    },
    INTAKE_REPLAY_MAX_BATCH: {
      universalIdentifier: IDS.VAR_REPLAY_MAX_BATCH,
      value: '50',
      description: 'Most logs one bulk replay will process. Each replayed log writes to the CRM, so this bounds how much a single call can change. Hard ceiling of 500.',
    },
  },
});
