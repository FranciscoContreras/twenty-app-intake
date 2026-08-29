# Changelog

## [0.4.0] - 2026-08-29

### Fixed
- **Custom fields now reach the Opportunity.** `createOpportunity` built a fixed payload of `name`, `stage`, `pointOfContactId` and `companyId`, and the custom-field PATCH ran against `/people/` and `/companies/` only — so a deal attribute sent to the webhook (the service asked for, a stated budget, a lead id) had nowhere to land and was silently confined to the note. Opportunity now goes through the same create-then-PATCH path as Person and Company.
- **A rule naming a field that cannot be written no longer disappears.** `SyncSchemaStage` skipped any `canonicalName` that was neither standard nor `ext`-prefixed *and counted it as matched*, after which `UpsertRecordStage` filtered it out again by the same `ext` test — so a rule pointing at, say, `machinaService` reported success and wrote nothing. Such a field is now written when it already exists on the target object; when it does not, the value is routed to the note, a warning names the field, and it is no longer counted as matched.
- **Built-in composite parts can no longer be mistaken for unknown fields.** The standard-field set is now derived from `FIELD_MAP` rather than restated, so pre-composite canonical names (`email`, `phone`, `addressCity`) are always recognised.
- **`SKIP` and `NOTE` rules now do what they say.** A rule's action was read from a column that does not exist, so it came back `undefined` and `partition` treated it as a field to write — a rule configured to discard a value wrote it instead, and a `NOTE` rule tried to create a column literally named `NOTE`. The action is now derived from `fieldType`.
- **A rule's `targetObject` is now actually read.** The column was added to the object and consumed by the normalizer, but never selected in the GraphQL query that loads rules, so every rule resolved to `AUTO` and the Opportunity routing select did nothing.
- **Failed ingestions are recorded.** Only the happy path wrote an `IntakeLog`; a rejected signature, a paused source or a failed record write returned an error and left no trace, and `totalFailed` never moved off zero. Terminal failures now write a `FAILED` log. Unknown slugs are still not logged, so nobody can fill the workspace by POSTing to invented URLs, and duplicates are still not logged, so ingestions are not double-counted.
- **The dry-run endpoint loaded no field rules.** `/test` normalised with an empty rule set, so any payload depending on a rule was previewed incorrectly. It now loads the same rules the live pipeline does.

### Added
- **`targetObject` on `IntakeFieldRule`** — `AUTO` (default), `PERSON`, `COMPANY` or `OPPORTUNITY`. Routes a matched field to a specific record.
- **Opportunity key prefixes** — `opportunity_`, `opp_` and `deal_` route a field to the deal with no rule needed; the prefix is stripped before the `ext` name is built.
- **Standard Opportunity fields via rules** — `amount` and `closeDate` are set as the deal is created. `CURRENCY` values accept a bare number or a written figure and are converted to Twenty's micros.
- **Field-level merge policy** — `INTAKE_MERGE_POLICY`, a per-source `mergePolicy`, and a per-rule `mergeStrategy`. See *Changed* below for the default.
- **Idempotency keys** — an `Idempotency-Key` header or an `idempotencyKey` body field. Unlike hash deduplication it has no time window, so a double-submit, a client retry or a queue redelivery an hour later all resolve to the record made the first time. Stored on the log as `idempotencyKey`.
- **Spam quarantine, off by default** — `INTAKE_SPAM_FILTER_ENABLED`, `INTAKE_SPAM_SCORE_THRESHOLD` and `INTAKE_HONEYPOT_FIELD`, plus a per-source `honeypotField`. A held payload creates no Person, Company, Opportunity or Note; it becomes a `QUARANTINED` log carrying its score and reasons, and the webhook answers `202`. Review with `GET /s/intake/quarantine`, then `POST …/release` or `POST …/discard`. The honeypot works whether or not scoring is enabled.
- **Replay** — `POST /s/intake/logs/:logId/replay` re-runs one stored payload through the current rules, and `POST /s/intake/replay` does a bounded batch with a `dryRun` mode. Unlike retry it accepts logs that already succeeded, which is the point: a mapping added a week late can be applied to everything already received. New logs record `replayOfLogId`.
- **Raw-payload retention controls** — `INTAKE_RAW_PAYLOAD_RETENTION` (`FULL`/`NONE`) and `INTAKE_RAW_PAYLOAD_MAX_BYTES`. Credential-shaped keys (`password`, `token`, `secret`, `apikey`, `cvv`, `card`, `ssn` and similar) are now stripped from the stored copy under every setting. Oversized payloads are dropped rather than truncated, because a truncated payload cannot be parsed and so cannot be replayed.
- **Source-silence detection** — `expectedCadenceHours`, `healthStatus`, `silentSince`, `alertWebhookUrl` and `lastAlertAt` on `IntakeSource`, plus `POST /s/intake/sources/check-silence` to evaluate them on whatever timer you already run. Alerts fire once on the transition into silence, not on every check. Sources with no cadence set are never flagged.
- **`GET /s/intake/contract`** — every endpoint, the built-in field map grouped by destination, the custom fields that currently exist per object, the active rules, the registered sources and the settings in force, in one call. Signing secrets never appear.
- **Structured dry-run diff** — `/test` now returns per-object create-vs-update, the record it matched and on what, per-field merge outcomes against existing values, and the fields that would be added to the schema.
- **`spamScore`, `quarantineReason`, `idempotencyKey` and `replayOfLogId` on `IntakeLog`**; `QUARANTINED` and `DISCARDED` log statuses.
- **`GET /s/intake/health`** now reports silent sources, and accepts `?strict=true` to return `503` when any source has fallen silent.

### Changed
- **`INTAKE_MERGE_POLICY` defaults to `PRESERVE`, which changes what an update does.** Before 0.4.0 every update was a blind PATCH: whatever arrived overwrote whatever was there. `PRESERVE` fills fields that are empty and leaves anything already written alone. **Set `INTAKE_MERGE_POLICY=NEWEST_WINS` to restore 0.3.0 behaviour exactly.** This is the one default that changed, and it changed in the direction that cannot lose data — a returning enquiry can no longer overwrite a name a salesperson corrected by hand, and nothing in a CRM undoes a field a webhook overwrote overnight. Under both policies a blank incoming value never overwrites.
- **`/s/intake/health` response gained keys** (`version`, `sources`). The existing `status` and `timestamp` keys and the 200/503 behaviour are unchanged, so existing monitors are unaffected.
- **`/s/intake/:slug/test` response gained keys** (`diff`, `spam`, `mergePolicy`, `rulesApplied`, `warnings`) and kept the ones it had. `wouldCreate` and `notePreview` were replaced by the richer `diff` and `note` objects.
- **`Idempotency-Key` added to the webhook's forwarded headers.**

### Notes
- Field placement is explicit by design: nothing is routed to the Opportunity by inference. A key is only treated as a deal attribute when a prefix or a rule says so.
- `INTAKE_MAX_EXT_FIELDS` and `INTAKE_FIELD_CREATION_ENABLED` are honoured per object, Opportunity included.
- Every new behaviour except the merge default is off unless configured. Spam filtering is `false`, the honeypot is empty, and no source has a cadence until one is set.
- Queries that read the new columns fall back to the pre-0.4.0 column set if the workspace has upgraded the package but not yet re-synced its schema, so an upgrade cannot take a live webhook offline.
- Stored payloads contain whatever the sender submitted, including personal data. They live on `IntakeLog` under your workspace's own access control. `INTAKE_RAW_PAYLOAD_RETENTION=NONE` opts out, at the cost of retry and replay.

## [0.3.0] - 2026-08-09

### Fixed
- **Install now succeeds on modern Twenty servers** — 0.2.1 was built with `twenty-sdk@2.5.1`, whose build embedded server-owned system fields (`id`, `createdAt`, `updatedAt`, `deletedAt`, `createdBy`, `updatedBy`, `position`, `searchVector`) and standard-object morph relations (`noteTargets`, `taskTargets`, `timelineActivities`, `attachments`) into every custom object in `manifest.json`. Twenty >= 2.20 rejects those during metadata sync with `METADATA_VALIDATION_FAILED`. Rebuilding against `twenty-sdk@2.29.0` drops them — the three custom objects now declare only their own application fields (68 emitted fields down to 32).
- **Settings tab appears again** — migrated from the deprecated `settingsCustomTabFrontComponentUniversalIdentifier` pointer on `defineApplication`, which modern servers ignore entirely, to `defineSettingsFrontComponent()` in `src/front-components/settings-panel.tsx`. The build now emits `settingsFrontComponent` in the manifest. The component's universal identifier is unchanged.

### Changed
- **Logo now ships with the app** — replaced the external `logoUrl` (a raw.githubusercontent.com link, stripped from the manifest by the current SDK) with the bundled `logo: 'public/logo.svg'`.
- **Application category** — `data` → `Data`, matching the SDK's `APPLICATION_CATEGORIES` list.
- **Default role** — dropped the deprecated `defaultRoleUniversalIdentifier` from `defineApplication`; the role is picked up from the existing `defineApplicationRole()` export in `src/default-role.ts`.
- **Manifest metadata** — added `author` and `issueReportUrl` for the marketplace listing.
- **Engine requirements** — `node: ^24.5.0`, `yarn: >=4.0.2`, `twenty: >=2.26.0` (the last becomes the manifest's `requiredServerVersionRange`).
- **Dependencies** — `twenty-sdk` and `twenty-client-sdk` moved to `devDependencies` and pinned to `2.29.0`; they are build-time tooling, not runtime deps.

### Removed
- **Unused `neverthrow` and `cockatiel` dependencies** — never imported anywhere in `src/`; error handling uses the hand-rolled `Result` type in `src/lib/result.ts`.

## [0.2.1] - 2026-06-12

### Fixed
- **README and LICENSE now ship in the npm package** — `twenty publish` only packs the compiled `.twenty/output/`, which omitted `README.md` and `LICENSE`, leaving the npm listing with "No README data found". The `publish:app` script now copies both into the build output before publishing.

### Added
- `LICENSE` file (MIT) — previously referenced in the README and `package.json` but missing from the repo.

### Changed
- `typecheck` script now runs `twenty typecheck` (SDK-aware) instead of raw `tsc --noEmit`, which failed against a tsconfig without node types, DOM lib, or the JSX flag.

## [0.2.0] - 2026-05-20

### Added
- **Retry failed ingestions** — IntakeLog records now store the original raw payload. Failed logs show a Retry tab in the Twenty UI. Retry skips deduplication so previously seen payloads re-run cleanly.
- **rawPayload field on IntakeLog** — Required for retry functionality. Stores original JSON, capped at 65k chars.
- **Post-install hook** — On fresh install, automatically creates a "Getting Started" IntakeSource with a webhook URL and HMAC secret, plus 3 global IntakeFieldRules covering common non-obvious mappings (phoneNumber, emailAddress, fullName).
- **skipDedup flag on PipelineContext** — Retry path bypasses the IdempotencyStage without removing it from the pipeline.
- **Retry logic function** — `POST /s/intake/logs/:logId/retry` re-runs the pipeline for any failed log using the stored raw payload.
- **LLMS.md** — Comprehensive AI-readable documentation. Answers common developer questions about connecting forms and webhooks to Twenty CRM.
- **Logo** — SVG funnel icon committed to `/public/logo.svg`.
- **GitHub topics** — `twenty-app`, `crm`, `webhook`, `lead-capture`, `contact-form`, `automation`.

### Changed
- **package.json version** — Bumped to `0.2.0`.
- **Package description** — Rewritten to lead with keywords: "The missing ingestion layer for Twenty CRM."
- **Package keywords** — Expanded to 13 terms covering CRM, webhook, lead-capture, and integration search intent.
- **README** — Complete rewrite using research-backed structure: pain-point headline, code example in first fold, comparison table, integration recipes.
- **IntakeLog write** — Now stores `rawPayload` and links to IntakeSource via `intakeSourceId`.
- **Application description** — Updated in `defineApplication` to match new positioning.

### Fixed
- IntakeSource `totalIngested` counter now increments correctly after each successful ingestion.
- IntakeLog `intakeSourceId` field now correctly linked to IntakeSource on write.

## [0.1.0] - 2026-05-19

### Added
- Initial release
- 9-stage ingestion pipeline (detect structure → verify HMAC → idempotency → flatten → normalize → sync schema → upsert record → write log)
- 3 custom objects: IntakeSource, IntakeLog, IntakeFieldRule with full relations
- 4 logic functions: webhook receiver, health check, source registration, dry-run test
- 3 front components: Dashboard, Source Panel, Settings Panel
- 2 views: Intake Sources, Intake Logs
- Navigation sidebar item
- 6 configurable settings via applicationVariables (Settings tab)
- HMAC-SHA256 webhook signature verification
- Idempotency via SHA-256 payload hash
- Auto-schema extension via MetadataApiClient (ext prefix fields)
- Two-step record upsert: standard fields first, custom fields patched separately
- GraphQL dedup for company records
- Note creation with NoteTarget linking to both Person and Company
- Opportunity auto-creation with configurable name template
- 68 unit tests passing
