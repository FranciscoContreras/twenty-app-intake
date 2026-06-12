# Changelog

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
