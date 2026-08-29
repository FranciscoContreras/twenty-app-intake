# Changelog

## [0.4.0] - 2026-08-29

### Fixed
- **Custom fields now reach the Opportunity.** `createOpportunity` built a fixed payload of `name`, `stage`, `pointOfContactId` and `companyId`, and the custom-field PATCH ran against `/people/` and `/companies/` only — so a deal attribute sent to the webhook (the service asked for, a stated budget, a lead id) had nowhere to land and was silently confined to the note. Opportunity now goes through the same create-then-PATCH path as Person and Company.
- **A rule naming a field that cannot be written no longer disappears.** `SyncSchemaStage` skipped any `canonicalName` that was neither standard nor `ext`-prefixed *and counted it as matched*, after which `UpsertRecordStage` filtered it out again by the same `ext` test — so a rule pointing at, say, `machinaService` reported success and wrote nothing. Such a field is now written when it already exists on the target object; when it does not, the value is routed to the note, a warning names the field, and it is no longer counted as matched.
- **Built-in composite parts can no longer be mistaken for unknown fields.** The standard-field set is now derived from `FIELD_MAP` rather than restated, so pre-composite canonical names (`email`, `phone`, `addressCity`) are always recognised.

### Added
- **`targetObject` on `IntakeFieldRule`** — `AUTO` (default), `PERSON`, `COMPANY` or `OPPORTUNITY`. Routes a matched field to a specific record.
- **Opportunity key prefixes** — `opportunity_`, `opp_` and `deal_` route a field to the deal with no rule needed; the prefix is stripped before the `ext` name is built.
- **Standard Opportunity fields via rules** — `amount` and `closeDate` are set as the deal is created. `CURRENCY` values accept a bare number or a written figure and are converted to Twenty's micros.

### Notes
- Field placement is explicit by design: nothing is routed to the Opportunity by inference. A key is only treated as a deal attribute when a prefix or a rule says so.
- `INTAKE_MAX_EXT_FIELDS` and `INTAKE_FIELD_CREATION_ENABLED` are honoured per object, Opportunity included.

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
