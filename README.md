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

Returns a structured diff of what *would* happen, without touching the CRM: per object
whether it would be **created or updated**, which existing record it matched and on
what, what each field would do to the value already there, and which fields do not
exist yet and would be added to the schema. Plus the spam score the payload would get.

```jsonc
{
  "dryRun": true,
  "diff": {
    "objects": [{
      "object": "person",
      "operation": "update",
      "recordId": "8f21…",
      "matchedBy": { "field": "emails.primaryEmail", "value": "jane@co.com" },
      "fields": [
        { "name": "name", "status": "preserved", "existing": {…}, "incoming": {…} },
        { "name": "phones", "status": "fill-empty", "incoming": {…} },
        { "name": "extBudget", "status": "create", "fieldWouldBeCreated": true }
      ],
      "fieldsToCreate": [{ "name": "extBudget", "type": "NUMBER" }]
    }]
  }
}
```

Because it is machine-readable, this is the gate to put in front of live traffic —
assert on it in a deployment check rather than reading it by eye.

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

Key matching ignores case and separator style, so `Email`, `email`, `E-Mail`, `EMAIL`
and `emailAddress` all reach the same mapping. Nested payloads are flattened first —
`{"contact": {"first_name": "Jane"}}` becomes `contactFirstName`.

> **Fixed in 0.5.0.** A key that merely *started* with a capital — `Email`, `Phone`,
> `First Name`, the default labels most form builders send — missed the built-in map
> entirely and fell through to passthrough, producing a person with an `extEmail`
> column and no email address on the record. Because deduplication runs on the email,
> every later submission from that person created another copy. If a source of yours
> sends capitalised keys, look for `extEmail`, `extPhone` and `extFirstName` columns
> left behind by earlier runs.

Unknown fields get an `ext_` prefix and are created as custom fields the first time they appear.

---

## Custom field rules

Add `IntakeFieldRule` records to extend or override the built-in map for a specific source or globally:

| Field | Description |
|---|---|
| `inputPattern` | Exact key name or JavaScript regex — see [How a pattern is matched](#how-a-pattern-is-matched) |
| `canonicalName` | Target field in Twenty. An `ext`-prefixed name (`extBudget`) is created automatically; any other name must already exist on the target object |
| `fieldType` | `TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `DATE_TIME`, `CURRENCY`, `LINKS`, `EMAILS`, `PHONES`, `RICH_TEXT`, `RAW_JSON`, `NOTE`, or `SKIP` |
| `targetObject` | `AUTO` (default), `PERSON`, `COMPANY`, or `OPPORTUNITY` |
| `mergeStrategy` | `INHERIT` (default), `PRESERVE`, or `NEWEST_WINS` — see [Updating existing records](#updating-existing-records) |
| `priority` | Higher = checked first (0–100) |

Rules with no source linked apply globally across all sources.

### Which mapping wins

Every incoming key is resolved in this order:

1. **Your rules**, highest `priority` first
2. **The built-in map**
3. **Passthrough** — an `ext`-prefixed custom field with an auto-detected type

A rule beats the built-in map. That is what makes a rule worth configuring: it is
how `utm_source` becomes a real field instead of a line in the note, and how a
`website` goes somewhere other than the company's domain.

> **Changed in 0.5.0.** Before 0.5.0 the built-in map was consulted *first*, so a
> rule naming any of the 100+ built-in keys was silently ignored — the opposite of
> what this page has always described. If you wrote a rule against a built-in key
> and worked around it doing nothing, that workaround is now live. Check any rule
> matching `utm_*`, `website`, `url`, `domain`, `message`, `notes`, `city`, `state`
> or `country` before upgrading.

**One exception.** A rule cannot take a contact's `name`, `email` or `phone` away
from the contact — it may restate the mapping and set the type, target and merge
strategy, but it cannot send the value to a different field, to the note, or to the
bin. A person with no email cannot be found again, so the next submission from the
same address would create a duplicate, and the one after that another. When a rule
is turned away for this reason the ingest log says so by name.

To put a second address or a company switchboard somewhere of your own, match a key
the built-in map does not already own — `company_email`, `alt_phone`, `direct_line`.
Those behave like any other key.

### How a pattern is matched

`inputPattern` is tried as an exact key name first, then as a JavaScript regex
(case-insensitive). Both are tested against **both spellings of the key**: the
literal key as it arrived, and its `snake_case` form.

Nested payloads are flattened to camelCase before rules run, so `{"lead": {"id": 1}}`
arrives as `leadId`. Writing `^lead_id$` or `^leadId$` therefore both work, and so
does the bare string `lead_id`.

> **Fixed in 0.5.0.** Patterns were previously tested against the camelCased key
> only, so `^lead_id$` never matched anything while the bare string `lead_id` matched
> fine. Patterns without underscores — `budget`, `amount`, `gclid` — were unaffected,
> which made the failure look arbitrary. A regex that was silently dead may now start
> matching; check any pattern you wrote with an underscore in it.

A pattern that is not valid regex still works as an exact key match rather than
being discarded.

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

### Companies from email domains

**Intake never reads an employer out of an email address.** A company is created
only when the payload actually names one (`company`, `business`, `organization`) or
gives a domain of its own (`website`, `domain`, `url`). A lead from
`jane@gmail.com` with no company field creates a person and no company at all.

This is deliberate. Most small-business enquiries arrive from a consumer mailbox, so
a webhook that inferred companies from email domains would fill the Companies table
with mail hosts — a company called "gmail.com" with forty unrelated people filed
under it. If a mail provider arrives in a *website* field, Intake leaves it off the
company record and says so in the ingest log rather than storing it.

> **Twenty itself does infer companies this way, and it is on by default.** Every new
> workspace is seeded with a workflow called **"Create company when adding a new
> person"**, which fires on any person whose `emails` field is written — including
> people created through the REST and GraphQL APIs, and therefore including everything
> Intake writes. It extracts the domain from the person's email, creates a company for
> it if none matches, and then **updates the person's `companyId` to point at it** —
> overwriting the company Intake had already linked them to.
>
> The symptom is one lead producing two companies: the correct one on the Opportunity,
> and a domain-named one on the Person. Twenty's workflow skips a list of common
> personal domains (`gmail.com`, `yahoo.com`, `outlook.com`, `icloud.com` and similar),
> so it shows up on leads from business addresses.
>
> Nothing an app can send suppresses it — passing an explicit `companyId` does not.
> If you want Intake's company linkage to stand, open **Settings → Workflows**, find
> "Create company when adding a new person", and deactivate it.

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
| `mergePolicy` | — | Overrides `INTAKE_MERGE_POLICY` for this source |
| `honeypotField` | — | Overrides `INTAKE_HONEYPOT_FIELD` for this source |
| `expectedCadenceHours` | — | How long this source may go quiet before it counts as silent |
| `alertWebhookUrl` | — | Posted to once when this source falls silent |

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
| `INTAKE_MERGE_POLICY` | `PRESERVE` | What an update does to a field that already has a value |
| `INTAKE_SPAM_FILTER_ENABLED` | `false` | Score payloads and quarantine at the threshold |
| `INTAKE_SPAM_SCORE_THRESHOLD` | `5` | Score at which a payload is held |
| `INTAKE_HONEYPOT_FIELD` | — | Name of a hidden form field that quarantines when filled |
| `INTAKE_RAW_PAYLOAD_RETENTION` | `FULL` | `FULL` keeps payloads for replay; `NONE` keeps none |
| `INTAKE_RAW_PAYLOAD_MAX_BYTES` | `65000` | Largest payload stored for replay |
| `INTAKE_REPLAY_MAX_BATCH` | `50` | Cap on one bulk replay (hard ceiling 500) |

---

## Updating existing records

When a payload matches a contact or company that already exists, `INTAKE_MERGE_POLICY`
decides what happens to fields that already hold a value.

| Policy | Behaviour |
|---|---|
| `PRESERVE` *(default)* | Fills fields that are empty, leaves everything else as it is |
| `NEWEST_WINS` | The incoming payload overwrites — how versions before 0.4.0 behaved |

Under both policies a **blank incoming value never overwrites anything**. An absent
field means the sender had nothing to say about it, not that it should be cleared.

`PRESERVE` is the default because the alternative loses data with no record of what
was there. A returning enquiry typed in lowercase should not replace a name a
salesperson corrected by hand, and nothing in a CRM undoes a field a webhook
overwrote at 3am.

Override it per source with the source's `mergePolicy`, or per field with a rule's
`mergeStrategy` — useful for genuinely volatile attributes:

| inputPattern | canonicalName | mergeStrategy |
|---|---|---|
| `lead_score` | `extLeadScore` | `NEWEST_WINS` |

The response body reports what the policy did, per object and per field, under
`mergeDecisions`.

**Upgrading from 0.3.0 and want the old behaviour?** Set `INTAKE_MERGE_POLICY=NEWEST_WINS`.

> **If a source exists to refresh data, `PRESERVE` will stop it refreshing.**
> A pipeline that re-scans a business every week and sends back an updated rating,
> review count or score writes those values once and then never again, because
> under `PRESERVE` the field already holds a value. This is the one case where the
> new default is the wrong one. Fix it at whichever scope fits:
>
> - the whole source is a refresher → set its `mergePolicy` to `NEWEST_WINS`
> - only some fields change → give those rules `mergeStrategy: NEWEST_WINS`
> - every source is a refresher → set `INTAKE_MERGE_POLICY=NEWEST_WINS`
>
> Check `mergeDecisions` in the response, or the `Kept the existing …` warnings on
> the log, to see whether this is happening to you.

---

## Not sending the same lead twice

Send an `Idempotency-Key` header (or an `idempotencyKey` field in the body) and a
repeat of that key resolves to the record made the first time, instead of creating a
second one:

```bash
curl -X POST https://your-crm.com/s/intake/contact-form \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: submission-8f21c9" \
  -d '{"email":"jane@acme.com"}'
```

Unlike the content-hash deduplication — which only looks back
`INTAKE_DEDUP_WINDOW_MINUTES` — an idempotency key has **no time limit**. A
double-tapped submit button, a client retrying after a timeout and a queue
redelivering an hour later all resolve to the same record.

A key whose only previous use was quarantined or discarded is treated as unused, so
a released payload is not blocked by its own earlier attempt.

---

## Spam quarantine

Off by default. Two mechanisms, and they work independently.

**Honeypot** — set `INTAKE_HONEYPOT_FIELD` (or a source's `honeypotField`) to the
name of a form field hidden from people by CSS. Any payload arriving with it filled
was filled by a script, and is quarantined immediately. No false positives, so this
works whether or not scoring is enabled.

**Scoring** — set `INTAKE_SPAM_FILTER_ENABLED=true`. Each signal is worth points
rather than a verdict: a URL in a name field, a disposable or undeliverable email
domain, a link blast in the message, one long string pasted into every box, a
placeholder phone number. A payload is held when the total reaches
`INTAKE_SPAM_SCORE_THRESHOLD` (default `5`), so no single signal is enough on its own
— a genuine lead writing from a throwaway address still gets through.

Signals that would score *people* rather than behaviour are deliberately absent.
Non-Latin characters in a name and industry words like "SEO" carry no penalty.

A quarantined payload creates **no Person, Company, Opportunity or Note**. It is
recorded as an `IntakeLog` with status `QUARANTINED`, its score and its reasons, and
the webhook answers `202` — telling a bot which attempts were caught only teaches it
what to change, and a real person should not see a failure on a form that in fact
went through.

```bash
# What is being held, and why
curl https://your-crm.com/s/intake/quarantine -H "Authorization: Bearer $KEY"

# Let one through — the filter is overruled, the score is still recorded
curl -X POST https://your-crm.com/s/intake/quarantine/$LOG_ID/release -H "Authorization: Bearer $KEY"

# Mark one as junk; add {"purgePayload":true} to drop the stored body
curl -X POST https://your-crm.com/s/intake/quarantine/$LOG_ID/discard -H "Authorization: Bearer $KEY"
```

Turn scoring on only after watching the `spamScore` on a few days of real logs.

---

## Replay: applying a mapping you added too late

Every payload is stored on its log, so a rule written after the fact can be applied
to everything already received.

```bash
# One log, through the rules as they are now
curl -X POST https://your-crm.com/s/intake/logs/$LOG_ID/replay -H "Authorization: Bearer $KEY"

# A batch — see what would be touched first
curl -X POST https://your-crm.com/s/intake/replay \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"sourceSlug":"contact-form","since":"2026-08-01T00:00:00Z","dryRun":true}'

# Then run it
curl -X POST https://your-crm.com/s/intake/replay \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"sourceSlug":"contact-form","since":"2026-08-01T00:00:00Z","limit":50}'
```

Replay accepts logs that already **succeeded** — that is the point, since the
ingestion worked and only the mapping was missing. Retry is the narrower operation
and still refuses a successful log.

Replays run one at a time and are capped by `INTAKE_REPLAY_MAX_BATCH`, because each
one writes to the CRM. Each new log records `replayOfLogId`, so a re-mapped record
traces back to the payload it came from.

### What is stored, and what is not

`INTAKE_RAW_PAYLOAD_RETENTION=FULL` (the default) keeps each payload as sent, which
is what retry and replay run from. `NONE` keeps nothing and disables both.

Under either setting, **credentials are never stored** — keys containing `password`,
`token`, `secret`, `apikey`, `authorization`, `cvv`, `card`, `ssn` and similar are
replaced with `[redacted]` before the payload is written.

Everything else the sender submitted **is** kept, including names, emails and phone
numbers. It lives on the `IntakeLog` object under your workspace's own access
control and is readable by anyone who can read that object. Payloads over
`INTAKE_RAW_PAYLOAD_MAX_BYTES` are ingested normally but not stored — a truncated
payload cannot be parsed, so it is dropped rather than half-kept, and the log says so.

---

## Knowing when a source goes quiet

The failure nobody notices is the one that produces no error: a form that breaks in
February and is found in August, with nothing but absent leads as evidence.

Give a source an `expectedCadenceHours` and it becomes monitored. Sources without
one are never flagged — silence is only a fault where traffic was expected.

```bash
# Evaluate every source; run this on whatever timer you already have
curl -X POST https://your-crm.com/s/intake/sources/check-silence -H "Authorization: Bearer $KEY"
```

The check records `healthStatus` (`HEALTHY`, `SILENT`, `NEVER_RECEIVED`) and
`silentSince` on each source, and posts once to the source's `alertWebhookUrl` on
the transition into silence — once, not on every check. The body carries a `text`
key, so Slack, Discord and Teams incoming webhook URLs work unchanged.

`GET /s/intake/health` also reports silent sources. It still returns `200` and the
same `status` and `timestamp` keys it always did, so existing monitors are
unaffected. Point a monitor at `/s/intake/health?strict=true` to get a `503` when a
source has fallen silent.

---

## Asking the app what it accepts

```bash
curl https://your-crm.com/s/intake/contract -H "Authorization: Bearer $KEY"
```

One call returns every endpoint, the built-in field map grouped by destination, the
custom fields that currently exist on each object, the active rules, every
registered source and the settings in force — so an integrator or an agent can learn
the contract without reading source or introspecting Twenty's metadata API.

Signing secrets never appear; a source reports only whether it requires a signature.

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
| `POST` | `/s/intake/:slug/test` | None | Dry-run — structured diff, writes nothing |
| `GET` | `/s/intake/health` | None | Health check, plus silent sources |
| `GET` | `/s/intake/contract` | API key | What the app accepts and how it is configured |
| `POST` | `/s/intake/sources/register` | API key | Register a new source |
| `POST` | `/s/intake/sources/check-silence` | API key | Check every source against its cadence |
| `POST` | `/s/intake/logs/:logId/retry` | API key | Retry a **failed** ingestion |
| `POST` | `/s/intake/logs/:logId/replay` | API key | Re-run **any** stored payload through current rules |
| `POST` | `/s/intake/replay` | API key | Bulk replay a selection of logs |
| `GET` | `/s/intake/quarantine` | API key | List held payloads and why |
| `POST` | `/s/intake/quarantine/:logId/release` | API key | Ingest a held payload |
| `POST` | `/s/intake/quarantine/:logId/discard` | API key | Mark a held payload as junk |

### Response codes

| Code | Meaning |
|---|---|
| `200` | Ingested, or a duplicate resolved to the original record |
| `202` | Held for review by the spam filter — nothing was created |
| `401` | Signature missing or invalid |
| `404` | No source with that slug |
| `423` | Source is paused |

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
