<div align="center">
  <img src="./public/logo.svg" width="80" height="80" alt="Intake logo" />
  <h1>Intake</h1>
  <p><strong>The missing ingestion layer for Twenty CRM.</strong><br/>
  Wire any form, webhook, or data source to Twenty. Leads land clean — every time.</p>

  [![npm version](https://img.shields.io/npm/v/twenty-app-intake?color=0F172A&labelColor=334155&label=npm)](https://www.npmjs.com/package/twenty-app-intake)
  [![Twenty](https://img.shields.io/badge/Twenty-%3E%3D2.26.0-0F172A?labelColor=334155)](https://twenty.com)
  [![Tests](https://img.shields.io/badge/tests-68%20passing-22c55e?labelColor=334155)](https://github.com/FranciscoContreras/twenty-app-intake/actions)
  [![License](https://img.shields.io/badge/license-MIT-0F172A?labelColor=334155)](./LICENSE)
  [![Website](https://img.shields.io/badge/website-wearemachina.com-0F172A?labelColor=334155)](https://wearemachina.com)

  <sub>Built by <a href="https://wearemachina.com"><strong>Machina</strong></a></sub>
</div>

---

## The problem

Your contact forms, pipeline scrapers, and partner APIs each have their own field names. `phone_number` here, `phoneNumber` there, `tel` somewhere else. Half the time a new field appears and breaks your Zap. The other half, someone enters a duplicate that your team has to clean manually.

Intake handles all of it automatically.

## What it does

Send any JSON payload to Intake's webhook. It figures out the rest.

```bash
curl -X POST https://your-crm.com/s/intake/getting-started \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane",
    "last_name":  "Doe",
    "email":      "jane@acme.com",
    "phone_number": "415-555-0199",
    "company":    "Acme Inc",
    "message":    "Need a new website by Q3.",
    "utm_source": "google",
    "budget":     "25000"
  }'
```

**What Twenty gets:**
- ✅ Person record — Jane Doe, jane@acme.com, +1 415 555 0199
- ✅ Company record — Acme Inc (linked to Jane)
- ✅ Opportunity — "Getting Started — Jane Doe", stage: NEW
- ✅ Note — message + UTM source, formatted and attached
- ✅ Custom field `extBudget` auto-created on Person (first time only)

No Zaps. No middleware. No broken automations when your form adds a field.

---

## How it works

```
Any JSON payload
      │
      ▼
① Normalize    phone_number → phone, emailAddress → email, firstName + lastName → name
      │
      ▼
② Classify     short values → CRM fields │ prose / UTMs → note
      │
      ▼
③ Extend       unknown fields → auto-create ext custom fields on Person, Company or Opportunity
      │
      ▼
④ Deduplicate  match by email (Person) or domain (Company) before creating anything
      │
      ▼
⑤ Ingest       Person + Company + Opportunity + Note — one webhook, the full chain
      │
      ▼
⑥ Log          every ingestion recorded in IntakeLog with status, timing, field counts
```

---

## Get started

### 1. Install

From the Twenty marketplace in **Settings → Applications**, search for **Intake** and install.

On fresh install, Intake automatically creates a "Getting Started" source with a ready-to-use webhook URL.

### 2. Register a source

```bash
curl -X POST https://your-crm.com/s/intake/sources/register \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Contact Form",
    "slug": "contact-form",
    "targetObject": "AUTO"
  }'
```

```json
{
  "webhookUrl": "https://your-crm.com/s/intake/contact-form",
  "secret": "wh_live_abc123..."
}
```

### 3. Test without writing anything

```bash
curl -X POST https://your-crm.com/s/intake/contact-form/test \
  -H "Content-Type: application/json" \
  -d '{"first_name":"Jane","email":"jane@co.com","budget":"15000"}'
```

Returns exactly what *would* be created — standard fields, custom fields to create, note preview — without touching the CRM.

---

## Payload formats

Intake accepts any valid JSON. No required fields.

**Flat (contact form):**
```json
{
  "first_name": "Jane",
  "email": "jane@acme.com",
  "company": "Acme",
  "message": "Looking for a full rebrand.",
  "utm_source": "google"
}
```

**Structured (pipeline app):**
```json
{
  "company": {
    "name": "Acme Plumbing",
    "domainName": { "primaryLinkUrl": "https://acmeplumbing.com" },
    "address": { "addressCity": "San Jose", "addressState": "CA" }
  },
  "person": {
    "name": { "firstName": "John", "lastName": "Smith" },
    "emails": { "primaryEmail": "john@acmeplumbing.com" }
  },
  "google_rating": 4.7,
  "review_count": 143,
  "analysis": "Strong reviews, outdated website."
}
```

**Arbitrary nested:**
```json
{
  "submitted_by": { "full_name": "Alex Thompson", "contact_email": "alex@co.com" },
  "project": { "type": "SaaS Dashboard", "budget": "15k" },
  "referrer": "behance"
}
```

---

## Built-in field normalization

100+ mappings ship by default. Some highlights:

| Incoming key | Twenty field |
|---|---|
| `phone`, `phone_number`, `phoneNumber`, `tel`, `mobile`, `cell` | `phones.primaryPhoneNumber` |
| `email`, `email_address`, `contact_email` | `emails.primaryEmail` |
| `first_name`, `firstName`, `fname` | `name.firstName` |
| `last_name`, `lastName`, `surname` | `name.lastName` |
| `name`, `full_name`, `fullName` | `name` (auto-split) |
| `company`, `company_name`, `business`, `organization` | Company record |
| `website`, `url`, `domain`, `homepage` | `domainName.primaryLinkUrl` |
| `utm_source/medium/campaign/content/term` | Note (always) |
| `message`, `description`, `notes`, `comments`, `analysis` | Note (always) |

Unknown fields get an `ext_` prefix and are created as custom fields the first time they appear.

---

## Custom field rules

Add `IntakeFieldRule` records to extend or override the built-in map for a specific source or globally:

| Field | Description |
|---|---|
| `inputPattern` | Exact key name or JavaScript regex |
| `canonicalName` | Target field in Twenty. An `ext`-prefixed name (`extBudget`) is created automatically; any other name must already exist on the target object |
| `fieldType` | `TEXT`, `NUMBER`, `LINKS`, `EMAILS`, `PHONES`, `BOOLEAN`, `DATE_TIME`, `CURRENCY`, `NOTE`, or `SKIP` |
| `targetObject` | `AUTO` (default), `PERSON`, `COMPANY`, or `OPPORTUNITY` |
| `priority` | Higher = checked first (0–100) |

Rules with no source linked apply globally across all sources.

### Writing to the Opportunity

Deal attributes — the service someone asked for, the budget they stated, your own
lead id — belong on the Opportunity, not the contact. Two ways to put them there:

**A prefix, no configuration.** Any incoming key beginning `opportunity_`, `opp_`
or `deal_` is routed to the deal, and the prefix is stripped before the field is
named — `opportunity_budget` becomes `extBudget` on the Opportunity.

```jsonc
{ "email": "jane@acme.com", "opportunity_budget": "25000", "opportunity_service": "SEO" }
```

**A rule, for keys you cannot rename.** Set `targetObject: OPPORTUNITY` on the rule
and point `canonicalName` at the field you want written:

| inputPattern | canonicalName | targetObject | fieldType |
|---|---|---|---|
| `service` | `machinaService` | `OPPORTUNITY` | `TEXT` |
| `budget` | `amount` | `OPPORTUNITY` | `CURRENCY` |

`amount` and `closeDate` are standard Opportunity fields and are set as the deal is
created; `amount` accepts a bare number or a written figure (`"$25,000/mo"`) and is
converted to Twenty's currency micros. Everything else is written as a custom field
in a follow-up call, so a rejected field never costs you the Opportunity itself.

A field routed to the Opportunity by a source that does not create one falls back to
the primary record, with a warning on the log.

### Fields that cannot be written

A rule pointing at a field that does not exist — and is not `ext`-prefixed, so cannot
be auto-created — has its value routed to the note, with a warning naming the field.
It is not counted as matched. Create the field in Twenty first, or rename the rule's
`canonicalName` to use an `ext` prefix.

---

## Source configuration

Each `IntakeSource` record controls:

| Field | Default | Description |
|---|---|---|
| `targetObject` | `AUTO` | `PERSON`, `COMPANY`, or auto-detect |
| `webhookSecret` | — | HMAC-SHA256 signing secret |
| `createOpportunity` | `true` | Auto-create Opportunity per ingestion |
| `opportunityNameTemplate` | `{{source}} — {{firstName}} {{lastName}}` | Supports `{{source}}`, `{{firstName}}`, `{{lastName}}`, `{{email}}`, `{{company}}` |
| `status` | `ACTIVE` | Pause a source without deleting it |

---

## Workspace settings

Configurable from **Settings → Applications → Intake → Custom**:

| Setting | Default | Description |
|---|---|---|
| `INTAKE_APP_LABEL` | `Intake` | Name used in note titles and opportunity names |
| `INTAKE_DEFAULT_OPP_STAGE` | `NEW` | Stage for auto-created Opportunities |
| `INTAKE_FIELD_CREATION_ENABLED` | `true` | Toggle auto-schema extension |
| `INTAKE_MAX_EXT_FIELDS` | `50` | Cap on custom fields per object |
| `INTAKE_DEDUP_WINDOW_MINUTES` | `5` | Duplicate suppression window |
| `INTAKE_REQUIRE_HMAC` | `false` | Enforce signed webhooks globally |

---

## Webhook security

Sign requests with `HMAC-SHA256` using the source's secret:

```bash
SECRET="your-signing-secret"
PAYLOAD='{"email":"jane@co.com"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST https://your-crm.com/s/intake/contact-form \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

Sources without a secret accept unsigned requests — useful for internal tools. Set `INTAKE_REQUIRE_HMAC=true` to enforce signatures globally.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/s/intake/:slug` | HMAC or open | Ingest a payload |
| `POST` | `/s/intake/:slug/test` | None | Dry-run — preview without writing |
| `POST` | `/s/intake/logs/:logId/retry` | API key | Retry a failed ingestion |
| `GET` | `/s/intake/health` | None | Health check |
| `POST` | `/s/intake/sources/register` | API key | Register a new source |

---

## Retry failed ingestions

Every ingestion is logged in `IntakeLog`. Failed logs can be retried from the record's detail page in Twenty, or via API:

```bash
curl -X POST https://your-crm.com/s/intake/logs/LOG_ID/retry \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Development

```bash
git clone https://github.com/FranciscoContreras/twenty-app-intake
cd twenty-app-intake
yarn install

# Run unit tests
yarn test

# Connect to your Twenty instance
yarn twenty remote add --api-url https://your-crm.com --api-key YOUR_KEY --as production

# Sync in watch mode
yarn twenty dev

# One-shot sync
yarn twenty dev --once
```

---

## vs. the alternatives

| | Intake | Zapier/Make | Hookdeck | Custom webhook |
|---|---|---|---|---|
| Zero config | ✅ | ❌ Manual mapping | ❌ Write ingestion logic | ❌ Build everything |
| Auto schema extension | ✅ | ❌ New fields break flows | ❌ | ❌ |
| Native Twenty objects | ✅ | ❌ | ❌ | ❌ |
| Deduplication | ✅ | Partial | ❌ | Roll your own |
| Audit log | ✅ | ❌ | ✅ | ❌ |
| Self-hosted | ✅ | ❌ | Paid | ✅ |
| Open source | ✅ MIT | ❌ | ❌ | ✅ |

---

## License

MIT — built by [Machina](https://wearemachina.com) · [FranciscoContreras](https://github.com/FranciscoContreras)
