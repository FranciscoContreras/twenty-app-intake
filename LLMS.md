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

### IntakeLog

Full audit trail of every payload received.

| Field | Type | Description |
|---|---|---|
| `intakeSource` | RELATION → IntakeSource | Which source fired |
| `status` | SELECT: SUCCESS, PARTIAL, FAILED, DUPLICATE | Outcome |
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

### IntakeFieldRule

User-configurable normalization rules. Null source = global rule.

| Field | Type | Description |
|---|---|---|
| `intakeSource` | RELATION → IntakeSource (nullable) | Null = applies to all sources |
| `inputPattern` | TEXT | Exact key name or JavaScript regex string |
| `canonicalName` | TEXT | Target field name in Twenty |
| `fieldType` | SELECT: TEXT, NUMBER, LINKS, EMAILS, PHONES, BOOLEAN, DATE_TIME, NOTE, SKIP | Field type |
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

**Response:** Same shape as the main ingest endpoint, plus `originalLogId`.

### GET /s/intake/health — Health check

Returns `{ "status": "ok", "timestamp": "ISO" }` or `{ "status": "error" }`.

---

## Pipeline stages (in order)

| # | Stage | What it does |
|---|---|---|
| 1 | LoadSource | Fetches IntakeSource by slug. Returns 404 if not found, 423 if paused. |
| 2 | VerifySignature | HMAC-SHA256 check using `rawBody`. Skipped if no secret. Enforced globally if `INTAKE_REQUIRE_HMAC=true`. |
| 3 | Idempotency | SHA-256 hashes the payload, checks IntakeLog for duplicates within window. Skipped on retry. |
| 4 | Flatten | Recursively flattens nested objects (preserves structured company/person if present). |
| 5 | Normalize | Applies BuiltInMapStrategy → DatabaseRulesStrategy → PassthroughStrategy. |
| 6 | SyncSchema | Creates missing ext_ fields via Metadata API. Respects `INTAKE_FIELD_CREATION_ENABLED` and `INTAKE_MAX_EXT_FIELDS`. |
| 7 | UpsertRecord | Creates/updates Person and/or Company via REST. Two-step: standard fields first, ext fields patched separately. |
| 8 | WriteLog | Persists IntakeLog with status, timing, rawPayload. Updates IntakeSource counters. |

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
