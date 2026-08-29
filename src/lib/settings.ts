/**
 * Every workspace setting Intake reads, in one place.
 *
 * The pipeline used to reach for `process.env` inline at each use site, which
 * meant the default for a setting lived wherever it happened to be read and the
 * contract endpoint had no way to report what was actually in force. Reading
 * them here keeps the defaults in one list and lets `GET /s/intake/contract`
 * answer "what is this app configured to do right now" honestly.
 */

export type MergePolicy = 'PRESERVE' | 'NEWEST_WINS';
export type RetentionMode = 'FULL' | 'NONE';

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function int(key: string, fallback: number): number {
  const parsed = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true';
}

export function appLabel(): string {
  return str('INTAKE_APP_LABEL', 'Intake');
}

export function defaultOpportunityStage(): string {
  return str('INTAKE_DEFAULT_OPP_STAGE', 'NEW');
}

export function fieldCreationEnabled(): boolean {
  return process.env['INTAKE_FIELD_CREATION_ENABLED'] !== 'false';
}

export function maxExtFields(): number {
  return int('INTAKE_MAX_EXT_FIELDS', 50);
}

export function dedupWindowMinutes(): number {
  return int('INTAKE_DEDUP_WINDOW_MINUTES', 5);
}

export function requireHmac(): boolean {
  return bool('INTAKE_REQUIRE_HMAC', false);
}

/**
 * How an update treats a field that already holds a value.
 *
 * PRESERVE fills blanks and leaves anything already written alone. It is the
 * default because the alternative loses data with no record of what was there:
 * a returning lead who types their name in lowercase should not overwrite the
 * corrected spelling a salesperson entered by hand. NEWEST_WINS restores the
 * last-write-wins behaviour of 0.3.0 and earlier.
 */
export function mergePolicy(): MergePolicy {
  return str('INTAKE_MERGE_POLICY', 'PRESERVE').toUpperCase() === 'NEWEST_WINS'
    ? 'NEWEST_WINS'
    : 'PRESERVE';
}

export function spamFilterEnabled(): boolean {
  return bool('INTAKE_SPAM_FILTER_ENABLED', false);
}

export function spamScoreThreshold(): number {
  return int('INTAKE_SPAM_SCORE_THRESHOLD', 5);
}

/** Workspace-wide honeypot key. A per-source value overrides it. */
export function honeypotField(): string {
  return str('INTAKE_HONEYPOT_FIELD', '');
}

export function rawPayloadRetention(): RetentionMode {
  return str('INTAKE_RAW_PAYLOAD_RETENTION', 'FULL').toUpperCase() === 'NONE'
    ? 'NONE'
    : 'FULL';
}

export function rawPayloadMaxBytes(): number {
  return int('INTAKE_RAW_PAYLOAD_MAX_BYTES', 65000);
}

export function replayMaxBatch(): number {
  return Math.min(int('INTAKE_REPLAY_MAX_BATCH', 50), 500);
}

/** Everything above, resolved, for the contract endpoint. */
export function snapshot(): Record<string, string | number | boolean> {
  return {
    INTAKE_APP_LABEL: appLabel(),
    INTAKE_DEFAULT_OPP_STAGE: defaultOpportunityStage(),
    INTAKE_FIELD_CREATION_ENABLED: fieldCreationEnabled(),
    INTAKE_MAX_EXT_FIELDS: maxExtFields(),
    INTAKE_DEDUP_WINDOW_MINUTES: dedupWindowMinutes(),
    INTAKE_REQUIRE_HMAC: requireHmac(),
    INTAKE_MERGE_POLICY: mergePolicy(),
    INTAKE_SPAM_FILTER_ENABLED: spamFilterEnabled(),
    INTAKE_SPAM_SCORE_THRESHOLD: spamScoreThreshold(),
    INTAKE_HONEYPOT_FIELD: honeypotField(),
    INTAKE_RAW_PAYLOAD_RETENTION: rawPayloadRetention(),
    INTAKE_RAW_PAYLOAD_MAX_BYTES: rawPayloadMaxBytes(),
    INTAKE_REPLAY_MAX_BATCH: replayMaxBatch(),
  };
}
