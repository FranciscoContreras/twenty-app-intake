# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Twenty CRM application** (installed from the Twenty marketplace, not a standalone server). It is a universal webhook receiver: POST any JSON to a source's webhook URL and it normalizes field names, auto-extends the CRM schema, deduplicates, and creates Person / Company / Opportunity / Note records. Runtime is Twenty's serverless logic-function host, not a process you start locally.

`LLMS.md` is the authoritative reference for the data model (IntakeSource / IntakeLog / IntakeFieldRule), HTTP endpoints, field-normalization rules, and config variables. Read it before changing behavior — this file covers *how the code is structured*, not *what it does*.

## Commands

```bash
yarn test                       # unit tests (vitest.config.ts → src/**/*.test.ts)
yarn test:watch                 # unit tests in watch mode
yarn test src/__tests__/normalizer.test.ts   # run a single test file
yarn test -t "splits full name"              # run tests matching a name
yarn test:integration           # integration tests against a LIVE Twenty instance (src/**/*.integration-test.ts)
yarn test:coverage              # coverage (thresholds enforced on src/lib/** and src/repositories/**)
yarn typecheck                  # twenty typecheck (SDK-aware; the same check `twenty build` runs internally)
yarn build                      # twenty build → .twenty/output/manifest.json
yarn twenty dev                 # sync definitions to the remote Twenty instance in watch mode
yarn twenty dev --once          # one-shot sync
yarn publish:app                # twenty publish
```

Node `>=24` (`.nvmrc` = 24). Package manager is **Yarn 4 / PnP** (`.pnp.cjs` is committed). Integration tests need a reachable Twenty instance (`TWENTY_API_URL`, `TWENTY_API_KEY`); they have a non-localhost default in `vitest.integration.config.ts`, so don't run them blindly.

Exec a logic function locally without HTTP:
```bash
yarn twenty exec -n intake-webhook -p '{"pathParameters":{"slug":"test"},"body":{...}}'
```

## Architecture

### Definitions are auto-discovered — there is no central index

The Twenty CLI globs `src/` and registers **every default export produced by a `defineX()` helper** from `twenty-sdk/define` (`defineApplication`, `defineObject`, `defineLogicFunction`, `definePostInstallLogicFunction`, `defineFrontComponent`, `defineView`, etc.). There is no `index.ts` wiring them together. To add a capability, create a file with one default `defineX()` export — that's the registration.

The definition files by directory:
- `src/application-config.ts` — `defineApplication` (the app manifest; declares `applicationVariables`, the post-install hook, and the settings-tab front component by UUID)
- `src/objects/` — the three custom objects + their fields & relations
- `src/logic-functions/` — HTTP route handlers (`webhook`, `health`, `register`, `test-ingest`, `retry`)
- `src/post-install.ts` — runs once on fresh install (seeds the "Getting Started" source + default field rules)
- `src/front-components/`, `src/views/`, `src/navigation-menu-items/`, `src/default-role.ts` — UI & access

### Universal Identifiers are load-bearing — never reuse or mutate them

`src/constants/universal-identifiers.ts` (`IDS`) is a registry of stable UUIDs. Every object, field, relation, logic function, view, and component references its UUID from here. Twenty uses these to track entities across syncs and version upgrades — **changing an existing UUID orphans the live entity and its data; reusing one collides.** When adding any new definition or field, generate a fresh UUID, add it to `IDS`, and reference it. Relations are wired by pointing both sides at each other's field UUIDs (see the reverse-relation fields in `intake-source.ts`).

### The ingestion pipeline (the core)

`webhook.ts` builds a `PipelineContext` and runs an 8-stage pipeline assembled in `src/lib/pipeline-factory.ts`. Each stage in `src/lib/stages/` implements `PipelineStage` (`name` + `execute(ctx) → Result<PipelineContext>`) and threads the **single mutable-but-spread `PipelineContext`** through (`src/lib/pipeline.ts`). Stage order is intentional and documented in `pipeline-factory.ts`:

`LoadSource → VerifySignature → Idempotency → Flatten → Normalize → SyncSchema → UpsertRecord → WriteLog`

- A stage returning `err(...)` aborts the run; the pipeline tags the error with the stage name. `webhook.ts` maps `ErrorCode` → HTTP status (e.g. `SOURCE_PAUSED` → 423, `DUPLICATE_PAYLOAD` → **200**, anything else → 500).
- **Non-fatal philosophy:** within `UpsertRecord`, only the core record create/update is allowed to fail the run. Opportunity, Note, and ext-field PATCH failures are swallowed and pushed onto `ctx.warnings` instead. Preserve this — the record should land even when peripherals fail.
- `ctx.skipDedup` lets the **retry** logic function re-run a stored `rawPayload` past the IdempotencyStage without removing the stage.

### Result type, not neverthrow

Error handling uses the hand-rolled discriminated union in `src/lib/result.ts` (`ok()` / `err()` / `Result<T>`, with the `ErrorCode` enum). `neverthrow` and `cockatiel` are in `package.json` but **not used** — don't introduce them assuming they're the established pattern; follow `result.ts`.

### Normalizer: 3-strategy priority + composite assembly

`src/lib/normalizer.ts` maps each flat key to a `NormalizedField` by priority: **(1) built-in `FIELD_MAP`** (`src/constants/field-map.ts`) → **(2) DB `IntakeFieldRule` records** (exact match or regex) → **(3) passthrough** (auto-detect type via `type-detector.ts`, classify field-vs-note via `classifier.ts`, prefix unknown CRM fields as `extPascalCase`). `partition()` then splits fields into CRM / note / skipped, and `assembleComposites()` reassembles Twenty's composite shapes (`name`, `emails`, `phones`, `domainName`, `address`) from individual canonical names. Custom fields **must** be `ext` + alphanumeric — Twenty's Metadata API requirement.

### Talking to Twenty: raw REST, not the typed SDK client

`src/lib/rest-client.ts` wraps `fetch` against `/rest`, `/rest/metadata`, and `/graphql`, authed via the **runtime** env vars `TWENTY_API_URL` and `TWENTY_APP_ACCESS_TOKEN` (injected by the host). The typed `twenty-client-sdk` clients are passed into the factory but most real work goes through raw fetch **because dynamically created `ext` fields don't exist in the SDK's compile-time types.** Keep new CRM calls on `coreApi` / `metaApi` / `gql`.

`UpsertRecord` does a deliberate **two-step write**: create/update with standard fields first, then PATCH `ext` fields separately (so an invalid custom field can't block the record). Dedup happens here too — Person by `emails.primaryEmail`, Company by domain host (with a GraphQL fallback on duplicate-name errors).

### Runtime configuration

The six `applicationVariables` declared in `application-config.ts` surface to logic functions as **`process.env`** (e.g. `process.env['INTAKE_FIELD_CREATION_ENABLED']`, `INTAKE_MAX_EXT_FIELDS`, `INTAKE_DEFAULT_OPP_STAGE`). They're edited from Twenty's Settings UI, written back via the GraphQL mutation in `settings-panel.tsx`. When adding a setting: declare it in `application-config.ts` (with a UUID), read it via `process.env` where used, and add it to the `SETTINGS` array in `settings-panel.tsx`.

## Conventions

- Front components are plain React (v19) with **inline styles only** — no CSS framework, no imports beyond `react`. They run sandboxed in Twenty's UI and read `window.__TWENTY_API_URL__` / `__TWENTY_API_TOKEN__` for their own GraphQL calls.
- Tests are pure-unit by default (no network); the lib functions are written to be testable in isolation. Property-based tests use `fast-check`. Fixtures for the three payload shapes (flat / structured / arbitrary) live in `src/__tests__/fixtures/payloads/`.
- `src/repositories/` is empty but included in coverage thresholds — that's where data-access helpers are expected to go if extracted.
- Keep `CHANGELOG.md` updated for user-facing changes (Changesets is configured).
