# Intake

Universal lead ingestion for [Twenty CRM](https://twenty.com). Point any contact form, pipeline app, or external platform at a single webhook URL and Intake handles the rest — normalizing fields, auto-extending your schema, deduplicating records, and attaching a readable note with everything that didn't fit a field.

## What it does

- **Accepts any payload shape** — flat contact form data, nested structured objects, or anything in between
- **Normalizes field names automatically** — `phone`, `phone_number`, `phoneNumber`, `tel`, `mobile` all map to the same field
- **Extends your schema on the fly** — unknown fields become custom fields on Person or Company automatically, prefixed with `ext_`
- **Deduplicates** — matches existing Person records by email and Company records by domain before creating anything new
- **Attaches a note** — prose text, UTM params, and anything that can't become a field lands in a clean, readable markdown note linked to the record
- **Creates the full chain** — Person → Company → Opportunity → Note in one webhook call
- **Full audit trail** — every ingestion is logged in `IntakeLog` with status, field counts, and processing time

## Installation

From the Twenty marketplace in **Settings → Applications**, search for **Intake** and install.

Or via CLI:

```bash
yarn twenty install twenty-app-intake
```

## Quick start

### 1. Register a source

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

Response:

```json
{
  "webhookUrl": "https://your-crm.com/s/intake/intake/contact-form",
  "secret": "wh_live_abc123..."
}
```

### 2. Send a payload

```bash
curl -X POST https://your-crm.com/s/intake/intake/contact-form \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@acme.com",
    "company": "Acme Inc",
    "message": "Need a new website and SEO help.",
    "utm_source": "google"
  }'
```

Response:

```json
{
  "success": true,
  "recordType": "PERSON",
  "personId": "...",
  "companyId": "...",
  "opportunityId": "...",
  "fieldsCreated": 0,
  "fieldsMatched": 6,
  "overflowCount": 2,
  "processingMs": 312
}
```

## Supported payload formats

Intake accepts any valid JSON. No required fields.

**Flat contact form:**
```json
{
  "first_name": "Jane",
  "email": "jane@acme.com",
  "phone_number": "555-0100",
  "company": "Acme Inc",
  "message": "Interested in your services",
  "utm_source": "google"
}
```

**Structured (company + person):**
```json
{
  "company": {
    "name": "Acme Plumbing",
    "domainName": { "primaryLinkUrl": "https://acmeplumbing.com" },
    "address": { "addressCity": "San Francisco", "addressState": "CA" }
  },
  "person": {
    "name": { "firstName": "John", "lastName": "Smith" },
    "emails": { "primaryEmail": "john@acmeplumbing.com" }
  },
  "google_places_url": "https://maps.google.com/?cid=123",
  "google_rating": 4.2,
  "analysis": "Strong reviews, outdated website."
}
```

**Arbitrary nested:**
```json
{
  "submitted_by": { "full_name": "Maria Garcia", "contact_email": "maria@co.com" },
  "project": { "type": "Website Redesign", "budget": "$15k" },
  "utm_campaign": "spring-promo"
}
```

## Field normalization

Intake ships with built-in mappings for 100+ common field name variations:

| Incoming key | Canonical field |
|---|---|
| `phone`, `phone_number`, `phoneNumber`, `tel`, `mobile`, `cell` | `phones.primaryPhoneNumber` |
| `email`, `email_address`, `contact_email` | `emails.primaryEmail` |
| `first_name`, `firstName`, `fname` | `name.firstName` |
| `last_name`, `lastName`, `surname` | `name.lastName` |
| `name`, `full_name`, `fullName` | `name` (split into first/last) |
| `company`, `company_name`, `business`, `organization` | Company record |
| `website`, `url`, `domain`, `homepage` | `domainName.primaryLinkUrl` |
| `street`, `address_line_1` | `address.addressStreet1` |
| `city`, `state`, `zip`, `country` | `address.*` |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Note (always) |
| `message`, `description`, `notes`, `comments`, `analysis` | Note (always) |

Unknown fields are passed through with an `ext_` prefix and created as custom fields on the target object.

## Source configuration

Each source is an `IntakeSource` record with these options:

| Field | Description | Default |
|---|---|---|
| `name` | Display name | — |
| `slug` | URL segment — must be unique | — |
| `targetObject` | `PERSON`, `COMPANY`, or `AUTO` | `AUTO` |
| `webhookSecret` | HMAC-SHA256 signing secret | none (skip verification) |
| `createOpportunity` | Auto-create an Opportunity per ingestion | `true` |
| `opportunityNameTemplate` | Template string using `{{source}}`, `{{firstName}}`, `{{lastName}}`, `{{email}}`, `{{company}}` | `{{source}} — {{firstName}} {{lastName}}` |

Create and edit sources in **Settings → Applications → Intake → Intake Sources**, or via the registration endpoint.

## Webhook security

If a `webhookSecret` is set on the source, Intake verifies the `X-Webhook-Signature` header using HMAC-SHA256:

```
X-Webhook-Signature: sha256=<hex_digest>
```

The digest is computed over the raw request body using the source's secret. Requests with missing or invalid signatures are rejected with `401`.

Sources without a secret accept all requests — useful for internal tools or trusted platforms.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/s/intake/intake/:slug` | HMAC or open | Ingest a payload |
| `GET` | `/s/intake/intake/health` | None | Health check |
| `POST` | `/s/intake/sources/register` | Twenty API key | Register a new source |

## Custom field rules

Add `IntakeFieldRule` records to override the built-in normalization for a specific source or globally:

| Field | Description |
|---|---|
| `inputPattern` | Exact key name or JavaScript regex |
| `canonicalName` | Target field in Twenty (use `ext_` prefix for custom fields) |
| `fieldType` | `TEXT`, `NUMBER`, `LINKS`, `EMAILS`, `PHONES`, `BOOLEAN`, `DATE_TIME`, `NOTE`, or `SKIP` |
| `priority` | Higher rules are checked first |

Rules with no source linked apply globally across all sources.

## Development

```bash
# Clone and install
git clone https://github.com/FranciscoContreras/twenty-app-intake
cd twenty-app-intake
yarn install

# Run unit tests
yarn test

# Watch mode
yarn test:watch

# Connect to your Twenty instance
yarn twenty remote add --api-url https://your-crm.com --api-key YOUR_KEY --as production

# Sync to server (watch mode)
yarn twenty dev

# One-shot sync
yarn twenty dev --once
```

## License

MIT
