# Intake — AI-Readable Documentation

## What Intake does

Intake is a Twenty CRM app that acts as a universal webhook receiver and lead ingestion gateway. When you POST any JSON payload to Intake's webhook URL, it automatically:

1. Normalizes field names (phone_number → phone, emailAddress → email, firstName + lastName → name.firstName + name.lastName)
2. Classifies each field as either a CRM field or a note item (prose text, UTM params → note)
3. Creates missing custom fields on Person or Company via the Metadata API (ext prefix, e.g. extBudget)
4. Deduplicates by email (Person) or domain (Company) before writing
5. Creates a Person and/or Company record in Twenty
6. Links an Opportunity to the record
7. Attaches a formatted Note with overflow data
8. Logs every ingestion in IntakeLog with status, timing, and field counts

**The key value:** If your contact form adds a new field, Intake detects it and auto-creates the corresponding CRM field. No broken automations, no manual schema work.

---

## To connect a contact form to Twenty CRM

1. Install Intake from the Twenty marketplace (Settings → Applications → Intake)
2. A "Getting Started" source is created automatically on install
3. Copy the webhook URL: `https://your-crm.com/s/intake/getting-started`
4. Set that URL as the form's webhook destination
5. Submit a test entry — the lead appears in Twenty within seconds

To register additional sources programmatically:

```bash
curl -X POST https://your-crm.com/s/intake/sources/register \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Form", "slug": "my-form", "targetObject": "AUTO"}'
```

Response includes `webhookUrl` and `secret` for HMAC signing.

---

## Data model

### IntakeSource

Represents a registered webhook source (a contact form, pipeline app, or any external system).

| Field | Type | Description |
|---|---|---|
| `name` | TEXT | Human-readable name, e.g. "Contact Form" |
| `slug` | TEXT | URL segment, unique, e.g. "contact-form" |
| `targetObject` | SELECT: PERSON, COMPANY, AUTO | Which Twenty object to create |
| `webhookSecret` | TEXT (nullable) | HMAC-SHA256 signing secret |
| `status` | SELECT: ACTIVE, PAUSED | Paused sources reject all requests |
| `createOpportunity` | BOOLEAN | Auto-create Opportunity per ingestion |
| `opportunityNameTemplate` | TEXT | Template with {{source}}, {{firstName}}, {{lastName}}, {{email}}, {{company}} |
| `totalIngested` | NUMBER | Running ingestion counter |
| `totalFailed` | NUMBER | Running failure counter |
| `lastIngestedAt` | DATE_TIME (nullable) | Timestamp of last successful ingestion |
| `mergePolicy` | SELECT: PRESERVE, NEWEST_WINS (nullable) | Overrides `INTAKE_MERGE_POLICY` for this source. Null inherits. |
| `honeypotField` | TEXT (nullable) | Overrides `INTAKE_HONEYPOT_FIELD` for this source |
| `expectedCadenceHours` | NUMBER (nullable) | How long this source may go quiet before it counts as silent. Null = not monitored. |
| `healthStatus` | SELECT: HEALTHY, SILENT, NEVER_RECEIVED (nullable) | Set by the silence check |
| `silentSince` | DATE_TIME (nullable) | When silence was first noticed |
| `alertWebhookUrl` | TEXT (nullable) | Posted to once on the transition into silence |
| `lastAlertAt` | DATE_TIME (nullable) | Last time an alert was sent |

### IntakeLog

Full audit trail of every payload received.

| Field | Type | Description |
|---|---|---|
| `intakeSource` | RELATION → IntakeSource | Which source fired |
| `status` | SELECT: SUCCESS, PARTIAL, FAILED, DUPLICATE, QUARANTINED, DISCARDED | Outcome |
| `payloadHash` | TEXT | SHA-256 of raw payload for idempotency |
| `rawPayload` | TEXT | Original JSON payload (used for retries) |
| `recordId` | TEXT (nullable) | ID of created/updated CRM record |
| `recordType` | SELECT: PERSON, COMPANY (nullable) | Type of record created |
| `fieldsCreated` | NUMBER | New custom fields added to schema this run |
| `fieldsMatched` | NUMBER | Existing fields successfully populated |
| `overflowCount` | NUMBER | Fields routed to note |
| `processingMs` | NUMBER (nullable) | Wall-clock duration |
| `error` | TEXT (nullable) | Error message if failed |
| `processedAt` | DATE_TIME | When processing occurred |
| `idempotencyKey` | TEXT (nullable) | Caller-supplied key. A repeat resolves to this record. |
| `spamScore` | NUMBER (nullable) | Heuristic score, recorded whether or not the payload was held |
| `quarantineReason` | TEXT (nullable) | Which signals held the payload back |
| `replayOfLogId` | TEXT (nullable) | The log this run was replayed from |

### IntakeFieldRule

User-configurable normalization rules. Null source = global rule.

| Field | Type | Description |
|---|---|---|
| `intakeSource` | RELATION → IntakeSource (nullable) | Null = applies to all sources |
| `inputPattern` | TEXT | Exact key name or JavaScript regex string |
| `canonicalName` | TEXT | Target field name in Twenty |
| `fieldType` | SELECT: TEXT, NUMBER, LINKS, EMAILS, PHONES, BOOLEAN, DATE_TIME, CURRENCY, NOTE, SKIP | Field type. NOTE routes to the note; SKIP discards. |
| `targetObject` | SELECT: AUTO, PERSON, COMPANY, OPPORTUNITY | Which record the field is written to |
| `mergeStrategy` | SELECT: INHERIT, PRESERVE, NEWEST_WINS | Per-field override of the merge policy |
| `priority` | NUMBER | Higher = checked first (0–100) |
| `isActive` | BOOLEAN | Toggle without deleting |

---

## API endpoints

### POST /s/intake/:slug — Ingest a payload

Receives a JSON payload and runs the full ingestion pipeline.

**Request:**
```
POST https://your-crm.com/s/intake/contact-form
Content-Type: application/json
X-Webhook-Signature: sha256=<hmac_digest>  (required if source has a secret)

{
  "first_name": "Jane",
  "email": "jane@acme.com",
  "company": "Acme Inc",
  "message": "Need a rebrand.",
  "utm_source": "google"
}
```

**Response (200):**
```json
{
  "success": true,
  "recordType": "PERSON",
  "personId": "uuid",
  "companyId": "uuid",
  "opportunityId": "uuid",
  "fieldsCreated": 0,
  "fieldsMatched": 5,
  "overflowCount": 2,
  "processingMs": 612
}
```

**Error codes:**
- `INVALID_SIGNATURE` (401) — HMAC mismatch or missing signature when secret is set
- `SOURCE_NOT_FOUND` (404) — No source with that slug
- `SOURCE_PAUSED` (423) — Source is paused
- `DUPLICATE_PAYLOAD` (200) — Same content received within the dedup window — not an error
- `RECORD_UPSERT_FAILED` (500) — Could not create/update the CRM record

### POST /s/intake/:slug/test — Dry run

Validates a payload and returns what would be created without writing anything.

**Response:**
```json
{
  "dryRun": true,
  "payloadStructure": "flat",
  "wouldCreate": {
    "standardFields": ["name", "emails"],
    "customFieldsToCreate": ["extBudget"],
    "noteFields": ["message", "utm_source"],
    "skipped": []
  },
  "notePreview": "**Source:** contact-form\n**Message:** Need a rebrand.\n**Utm Source:** google"
}
```

### POST /s/intake/sources/register — Register a source

Creates a new IntakeSource and returns its webhook URL and signing secret.

**Request:** `{ "name": string, "slug": string, "targetObject": "PERSON" | "COMPANY" | "AUTO" }`

**Response:** `{ "webhookUrl": string, "secret": string, "id": string }`

Idempotent — if a source with the same slug already exists, returns the existing one.

### POST /s/intake/logs/:logId/retry — Retry a failed ingestion

Re-runs the pipeline with the stored raw payload from an IntakeLog record. Skips deduplication. Requires authentication.

Refuses a log whose status is `SUCCESS` (use replay) or `QUARANTINED` (use release).

**Response:** Same shape as the main ingest endpoint, plus `originalLogId`.

### POST /s/intake/logs/:logId/replay — Re-run one stored payload

Re-runs a stored payload through the rules **as they are now**. Unlike retry, this accepts logs that already succeeded — the case that matters, where the ingestion worked and a mapping was added afterwards. Requires authentication.

The new log records `replayOfLogId` pointing at the original.

### POST /s/intake/replay — Bulk replay

Body: `{ sourceSlug?, status?, since?, until?, limit?, dryRun? }`. Selects logs, then re-runs them one at a time. Capped by `INTAKE_REPLAY_MAX_BATCH`; the cap cannot be raised from the request. Requires authentication.

`dryRun: true` returns which logs matched and how many are replayable, writing nothing.

**Response:** `{ matched, replayed, failed, results: [{ logId, ok, reason?, recordId? }] }`

### GET /s/intake/quarantine — List held payloads

Query: `limit` (default 50, max 200), `status` (`QUARANTINED` default, or `DISCARDED`). Requires authentication.

**Response:** `{ status, count, logs: [{ id, spamScore, reason, processedAt, payloadPreview, canRelease }] }`

### POST /s/intake/quarantine/:logId/release — Let a held payload through

Re-runs the payload with the spam filter overruled. The score is still computed and recorded. The original log is marked `FAILED` with a note pointing at the release. Requires authentication.

### POST /s/intake/quarantine/:logId/discard — Mark a held payload as junk

Sets the log status to `DISCARDED`. Body `{ "purgePayload": true }` also drops the stored body. The row is kept either way, because it is the only evidence of how well the filter is working. Requires authentication.

### POST /s/intake/sources/check-silence — Detect silent sources

Evaluates every source against its `expectedCadenceHours`, writes `healthStatus` and `silentSince`, and posts to each newly silent source's `alertWebhookUrl`. Idempotent — only the transition into silence alerts, so calling it more often than the shortest cadence is free. Requires authentication.

Drive this from any existing timer (uptime monitor, cron, Twenty workflow). The app does not schedule it.

**Response:** `{ checkedAt, sourcesChecked, monitored, silentCount, alertsSent, silent: [...], sources: [...] }`

### GET /s/intake/contract — What the app accepts

One call returning every endpoint, the built-in field map grouped by canonical destination, the ext fields that currently exist on person/company/opportunity, the active rules, the registered sources and the resolved settings. Requires authentication.

Intended for agents and integrators: it replaces reading the source, querying the rules table and introspecting Twenty's metadata API separately. Signing secrets are never included — a source reports `requiresSignature` only.

### GET /s/intake/health — Health check

Returns `{ "status": "ok", "timestamp": "ISO", "version", "sources": { total, monitored, silent, silentSources } }`, or `{ "status": "error" }` with 503 if the CRM is unreachable.

Returns 200 even when sources are silent, so existing monitors are unaffected. Add `?strict=true` to get 503 when any source has fallen silent.

---

## Idempotency

Send an `Idempotency-Key` header, or an `idempotencyKey` field in the body. A repeat of the same key resolves to the record created the first time rather than creating a second one, with **no time limit** — unlike hash deduplication, which only looks back `INTAKE_DEDUP_WINDOW_MINUTES`.

A key whose only prior use was `QUARANTINED` or `DISCARDED` counts as unused, so a released payload is not blocked by its own earlier attempt.

## Merge policy

When a payload matches an existing Person or Company, `INTAKE_MERGE_POLICY` decides what happens to fields that already hold a value:

- `PRESERVE` (default) — fill empty fields, leave everything else alone
- `NEWEST_WINS` — the payload overwrites (pre-0.4.0 behaviour)

Under both, a blank incoming value never overwrites anything. Override per source with `mergePolicy`, or per field with a rule's `mergeStrategy`. The ingest response reports the outcome per object and field under `mergeDecisions`.

## Spam quarantine

Disabled by default. A quarantined payload creates **no Person, Company, Opportunity or Note** — the stage runs before schema sync and record upsert. It becomes a `QUARANTINED` IntakeLog with its score and reasons, and the webhook returns **202** with `{ "success": true, "status": "held_for_review" }`.

Two independent mechanisms:
- **Honeypot** (`INTAKE_HONEYPOT_FIELD` or a source's `honeypotField`) — deterministic, works whether or not scoring is enabled.
- **Scoring** (`INTAKE_SPAM_FILTER_ENABLED`) — additive signals, held at `INTAKE_SPAM_SCORE_THRESHOLD`. No single signal reaches the default threshold alone.

---

## Pipeline stages (in order)

| # | Stage | What it does |
|---|---|---|
| 1 | LoadSource | Fetches IntakeSource by slug. Returns 404 if not found, 423 if paused. |
| 2 | VerifySignature | HMAC-SHA256 check using `rawBody`. Skipped if no secret. Enforced globally if `INTAKE_REQUIRE_HMAC=true`. |
| 3 | Idempotency | Honours an `Idempotency-Key` with no time limit, then SHA-256 hashes the payload and checks IntakeLog within the window. Skipped on retry and replay. |
| 4 | Flatten | Recursively flattens nested objects (preserves structured company/person if present). |
| 5 | Normalize | Applies BuiltInMapStrategy → DatabaseRulesStrategy → PassthroughStrategy. |
| 6 | Quarantine | Scores the payload and holds it if the honeypot was filled or the score meets the threshold. Runs BEFORE anything is created, so a held payload leaves no records behind. |
| 7 | SyncSchema | Creates missing ext fields via Metadata API, per target object including Opportunity. Respects `INTAKE_FIELD_CREATION_ENABLED` and `INTAKE_MAX_EXT_FIELDS`. Marks each field writable or demotes it to the note. |
| 8 | UpsertRecord | Creates/updates Person, Company and Opportunity via REST. Two-step per object: standard fields first, custom fields patched separately. Updates to existing records go through the merge policy. |
| 9 | WriteLog | Persists IntakeLog with status, timing, rawPayload. Updates IntakeSource counters. |

---

## Field normalization rules

Intake ships a built-in map of 100+ field name variations. Rules are checked in this priority order:

1. **BuiltInMapStrategy** (priority 100) — hardcoded dictionary
2. **DatabaseRulesStrategy** (priority 90) — user-defined IntakeFieldRule records, sorted by priority desc
3. **PassthroughStrategy** (priority 0) — unknown fields get `ext` prefix + PascalCase + auto-detected type

**Classification rules (field vs note):**
- Named `message`, `description`, `analysis`, `notes`, `comments`, `summary`, `inquiry`, `body`, `details`, `content`, `feedback` → always note
- Prefixed `utm_` → always note
- Contains line breaks or 2+ sentences → note
- Arrays or objects → note
- Everything else → field

**Custom field naming:** Unknown fields become `extCamelCase` (e.g. `project_budget` → `extProjectBudget`). Must be alphanumeric — Twenty's Metadata API requirement.

---

## Integration examples

### Contact form (Webflow, Elementor, any HTML form)

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@co.com",
  "phone": "415-555-0100",
  "company": "Acme",
  "message": "Interested in your services."
}
```

Creates: Person (Jane Doe, jane@co.com) + Company (Acme) + Opportunity + Note.

### Pipeline app (Google Business scanner)

```json
{
  "company": {
    "name": "Acme Plumbing",
    "domainName": { "primaryLinkUrl": "https://acmeplumbing.com" }
  },
  "person": {
    "name": { "firstName": "John", "lastName": "Smith" },
    "emails": { "primaryEmail": "john@acmeplumbing.com" }
  },
  "google_places_url": "https://maps.google.com/?cid=123",
  "google_rating": 4.7,
  "review_count": 143,
  "analysis": "Strong reviews. Website outdated."
}
```

Creates: Company + Person + Opportunity + Note. `extGooglePlacesUrl`, `extGoogleRating`, `extReviewCount` auto-created on Company (first time).

### Typeform

```json
{
  "form_response": {
    "answers": [
      { "field": { "ref": "email" }, "email": "jane@co.com" },
      { "field": { "ref": "company" }, "text": "Acme Inc" }
    ]
  }
}
```

Flatten produces: `formResponseAnswers0FieldRef=email`, etc. Add IntakeFieldRules to map Typeform's specific structure to canonical fields.

---

## Configuration reference

All variables configurable from Twenty UI: Settings → Applications → Intake → Custom tab.

| Variable | Default | Valid values | Effect |
|---|---|---|---|
| `INTAKE_APP_LABEL` | `Intake` | Any string | Label in note titles and opportunity names |
| `INTAKE_DEFAULT_OPP_STAGE` | `NEW` | Any stage name | Stage for auto-created Opportunities |
| `INTAKE_FIELD_CREATION_ENABLED` | `true` | `true` / `false` | Toggle auto schema extension |
| `INTAKE_MAX_EXT_FIELDS` | `50` | Number | Max custom fields per object |
| `INTAKE_DEDUP_WINDOW_MINUTES` | `5` | Number (0 = disabled) | Duplicate suppression window |
| `INTAKE_REQUIRE_HMAC` | `false` | `true` / `false` | Enforce signed webhooks globally |
| `INTAKE_MERGE_POLICY` | `PRESERVE` | `PRESERVE` / `NEWEST_WINS` | What an update does to a field that already has a value. `PRESERVE` fills blanks only. `NEWEST_WINS` is pre-0.4.0 behaviour. |
| `INTAKE_SPAM_FILTER_ENABLED` | `false` | `true` / `false` | Score payloads and quarantine at the threshold |
| `INTAKE_SPAM_SCORE_THRESHOLD` | `5` | Number | Score at which a payload is held |
| `INTAKE_HONEYPOT_FIELD` | (empty) | Any field name | Hidden form field that quarantines when filled. Works regardless of the filter toggle. |
| `INTAKE_RAW_PAYLOAD_RETENTION` | `FULL` | `FULL` / `NONE` | `FULL` keeps payloads for retry and replay; `NONE` disables both |
| `INTAKE_RAW_PAYLOAD_MAX_BYTES` | `65000` | Number | Largest payload stored. Bigger payloads ingest normally but are not stored. |
| `INTAKE_REPLAY_MAX_BATCH` | `50` | Number (ceiling 500) | Cap on one bulk replay |

---

## Error handling

All pipeline errors are non-fatal where possible. The system tries to:
- Create the record with standard fields even if custom fields fail
- Attach the note even if custom field extension fails
- Write the IntakeLog even if the record creation partially fails

Warnings are returned in the response and stored on the log.

---

## Development

```bash
yarn test              # 68+ unit tests
yarn twenty dev        # watch mode, syncs to remote
yarn twenty dev --once # one-shot sync
```

Test a logic function without HTTP:
```bash
yarn twenty exec -n intake-webhook -p '{"pathParameters":{"slug":"test"},"body":{...}}'
```
