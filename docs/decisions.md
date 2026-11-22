# Decisions

Architecture and product decisions made while building the portal, with the reasoning.
The field specification (`docs/CureNear_Provider_Onboarding_Field_Spec.md`) is the source of
truth for *what* we collect; this file records *how* and *why* we built it.

## 2026-11-20 — Foundations

### D1. Monorepo shape
`apps/web` (UI + API), `apps/worker` (outbox + cron), `packages/db` (Prisma + repositories),
`packages/shared` (schemas, registry, policy, utilities). Services live in
`apps/web/src/server/services` and depend on repository *ports* declared in
`packages/shared/src/ports.ts`, so service unit tests run without a database. Repositories map
Prisma rows to plain domain records; Prisma types never leak into the UI or the API contract.

### D2. Canonical enum values are lowercase
Provider types and statuses use the spec's lowercase values (`doctor`, `approved_not_live`,
…). Roles stay `ADMIN`/`STAFF` as specified. These strings are the public API contract and are
used verbatim in PostgreSQL enums.

### D3. Providers never authenticate
The portal has no provider-facing login. Section 3.1 of the spec (registrant mobile/email,
OTP, password) is therefore not collected; staff enter the provider's business data. When the
consumer app onboards providers directly, that account model must be designed separately.

### D4. Field registry is the executable spec
`packages/shared/src/field-registry.ts` enumerates every field we collect, section by section,
with type, requirement and options. Zod schemas, the API validation and the form UI are all
generated from it, so the form cannot drift from validation, and adding a field means editing
one file. Unknown keys are rejected: nothing outside the registry can be stored.

### D5. Conditional (`C`) fields are optional
The spec marks fields `C` with prose conditions. In this iteration `C` means "not mandatory on
submit" except where a cross-field rule is implemented (see D6). Rationale: submitting more
mandatory conditions than the spec states would block onboarding; the gap is tracked in
`docs/open-questions.md`.

### D6. Cross-field rules implemented
- `doc_restriction_details` required when `doc_restriction_flag` is true.
- `clinic_ce_reg_no` required when `clinic_ce_applicable = yes`; `clinic_ce_exempt_reason` when
  `exempt`.
- `ph_delivery_pins`, `ph_delivery_hours`, `ph_courier` required when `ph_delivery` is true.
- `contact_emergency` required for `care_provider`, `diagnostic_centre` and `clinic`.
- `dc_tests[*].test_name` matching a sex-determination pattern is rejected in **draft too**,
  not only on submit, because the spec says it must never be accepted.

### D7. Structural field keys for grouped values
A few spec rows describe a group whose sub-fields have no keys (e.g. `dc_nabl_details`
"text, date, file"). These are modelled as repeaters with structural sub-keys
(`number`, `authority`, `valid_to`, `document`, `scope`, …) and the container keys
`dc_nabl_details`, `dc_tests`, `dc_packages`, `practice_locations`, `cp_service_categories`,
`ph_licences`, `cp_licences`, `dc_establishment`, `dc_director`, `dc_signatories`, `dc_aerb`,
`clinic_other_licences`, `dc_other_licences`, `clinic_fees`. Additionally, where the
spec lists a text field "…, file" (`clinic_bmw`, `clinic_aerb`, `dc_pcpndt`, `dc_bmw`,
`cp_bmw`, `ph_fssai`), the file is stored as `<key>_doc`. These are the only keys not written
verbatim in the spec.

### D8. Money and PIN handling
Money fields accept rupees with at most two decimals and are stored as integer paise
(`rupeesToPaise`). PIN codes are validated as `/^[1-9][0-9]{5}$/` (six digits, no leading zero,
never numeric) and stored as `Char(6)`.

### D9. Files are metadata only
File fields store `{ fileName, mimeType, sizeBytes, uploadedAt, uploadedBy }` with a 10 MB and
PDF/JPG/PNG limit. Binary storage and malware scanning are out of scope for this portal; no
document contents are ever logged or sent in events.

### D10. PIN filtering uses a coverage table
`ProviderPinCode` holds every PIN a provider covers (registered office, each location, service
area) with an index on `pinCode`. `Provider.primaryPinCode` holds the registered-office PIN for
display and sorting. Filtering by PIN matches coverage, which is what discovery needs.

### D11. Derived columns
`displayName`, `legalName`, `city` and `primaryPinCode` are derived from form data on every
write, so lists can filter and sort without parsing JSON. Search uses `ILIKE` backed by
pg_trgm GIN indexes (migration `20260101000100_search_indexes`).

### D12. Status workflow
`statusTransitions` in `packages/shared/src/enums.ts` is enforced in the service layer. Approve
moves to `approved_not_live` (the consumer app is not live yet); `live`, `suspended` and
`terminated` exist in the model but no endpoint drives them in this iteration.

### D13. Optimistic locking
`Provider.version` starts at 1 and increments on every write. `updateOptimistic` and
`changeStatus` are `updateMany` calls filtered by `id + version + status`, so a lost update is
impossible; the API returns `409 VERSION_CONFLICT` with a reload message.

### D14. Audit is structural, not content
`AuditLog` stores actor, action, entity, request id, status transition, reason and the list of
changed **field keys**. Values (names, phones, addresses) are never copied into audit rows, in
line with the minimum-data rule. Revisions store a data snapshot for review recovery.

### D15. Outbox delivery and retries
Events are written in the same transaction as the state change. The worker claims with
`FOR UPDATE SKIP LOCKED`, increments `attempts`, and on failure sets `nextAttemptAt` with
exponential backoff capped at 15 minutes. `dedupeKey` (unique) makes licence reminders
idempotent per provider/field/date. Without `AGGREGATOR_WEBHOOK_URL` the worker logs the
envelope so local development needs no aggregator.

### D16. Idempotency
`IdempotencyRecord` has a unique `(userId, endpoint, key)` index. A replayed request returns
the original resource with `meta.idempotentReplay = true`; a reused key with a different body
returns `409 IDEMPOTENCY_MISMATCH`. Concurrent duplicates are caught by the unique index and
resolved by re-reading the record.

### D17. Authentication and sessions
Email + password with scrypt hashing (`node:crypto`, no native dependency). Session tokens are
random 32-byte values; only their SHA-256 hash is stored, and the cookie is HttpOnly,
SameSite=Lax, `Secure` when `APP_URL` is https. Login failures are identical for unknown email
and wrong password. There is no self-service password reset yet (see open questions).

### D18. API versioning and envelope
Routes live under `/api/v1`. Every response carries `requestId` (accepted from a valid
`x-request-id`, otherwise generated) and `Cache-Control: no-store`. Errors use
`{ error: { code, message, details, requestId } }` with the stable codes in
`packages/shared/src/errors.ts`. Adding `/api/v2` later means mounting a new route tree and
leaving v1 handlers intact.

### D19. Time zone handling
Timestamps are stored in UTC. List date filters are interpreted as Asia/Kolkata calendar days
(`kolkataDayStartUtc`, fixed +05:30 because India has no DST) and rendered with
`Intl.DateTimeFormat` in `Asia/Kolkata`.

### D20. UI component strategy
Tailwind plus local shadcn/ui-style primitives (`apps/web/src/components/ui`) using native
selects/checkboxes so every control is keyboard accessible and form-associated without extra
runtime dependencies. `components.json` is present, so `pnpm dlx shadcn@latest add …` can add
more components when needed.

### D21. Forms
A single registry-driven renderer supports all field types including nested repeaters,
addresses and geo pickers. Drafts validate with `mode: 'draft'` (partial allowed), submit
validates with `mode: 'submit'` on the server; the client mirrors draft validation and surfaces
server issues as a summary plus inline messages. Money inputs show rupees and are stored in
paise; PIN lists accept newline or comma separated input.

### D22. Version pinning and tooling
Next.js 15 (App Router, async `params`/`cookies`), React 19, Prisma 6, pg-boss 10 (explicit
queues; handlers receive a job batch), Zod 3. `packages/shared` and `packages/db` export
TypeScript source and are transpiled by Next (`transpilePackages`), so there is no separate
build step to forget.

### D23. Testing strategy
- Unit: RBAC matrix, registry validation, money/PIN/date utilities, service rules with
  in-memory repository fakes (audit + outbox assertions included).
- Integration (`pnpm test:int`): repositories and route handlers against real PostgreSQL,
  including optimistic locking, soft delete, idempotency unique constraints, auth failures and
  PIN filtering. Skipped when `TEST_DATABASE_URL` is absent.
- E2E (`pnpm e2e`): sign in, create a doctor draft, save and reload, submit validation errors.

### D24. Verification environment
While building, `pnpm typecheck` (all workspaces), `pnpm test` (36 unit tests) and
`pnpm --filter @curenear/web build` were run and passed. Integration and E2E suites could not
be executed on the build machine: Docker is not installed, and the PostgreSQL server listening
on port 5432 rejected the credentials available to the build (it belongs to another local
installation and was left untouched). Run `pnpm test:int` and `pnpm e2e` against a database you
control.

### D25. Docker
`docker compose up` starts Postgres, runs migrations + seed as a one-shot `migrate` service,
then starts the web app and the worker. The seed prints nothing sensitive and only creates the
admin if the email is missing.

## 2026-11-20 — Runtime verification against a real database

### D26. Stored money is re-validated as paise, never as rupees
Submit re-runs the registry schema over the stored payload. Because the rupee-facing money
schema converts to paise, re-validating already-normalised data multiplied every amount by
100 (₹500 was stored, then submitted, as ₹50,000). `buildProviderDataSchema` /
`validateProviderData` / `collectProviderDataIssues` now take
`{ moneyFormat: 'rupees' | 'paise' }`; API and form input keep `rupees`, and the submit
service passes `paise` so integers pass through unchanged. A shared test and the service test
pin the behaviour, and the HTTP walkthrough asserts `prac_fee === 50000` after saving ₹500.

### D27. Absent address/geo groups stay `undefined` in form defaults
Defaulting a group to `{}` made it "present" for the group's own required subfields, so
saving an almost-empty draft failed client-side with "Legal notice address: This field is
invalid" and never reached the API. `buildDefaultValues` now leaves an absent group
`undefined`; RHF creates the object on first keystroke. Drafts save with a single field filled
and submit still reports the missing mandatory fields.

### D28. Development database, roles and env files
The portal runs on the existing PostgreSQL 18 instance with a dedicated `curenear` login role
and `curenear` database (created with the superuser, then used with its own generated
password) rather than the superuser account. `SEED_ADMIN_NAME` is quoted because the env
files are valid dotenv *and* shell syntax. `packages/db` and `apps/worker` load
`dotenv/config`, so `pnpm db:seed` and `pnpm --filter @curenear/worker start` work without
exported variables, and `.env`, `apps/*/.env*` are gitignored.

## 2026-11-20 — Repository scaffolding

### D29. `packages/config` owns the shared TypeScript and ESLint setup
Compiler options live in `packages/config/tsconfig/{base,node,next}.json`; the root
`tsconfig.base.json` re-exports the base preset so every package keeps a single `extends`.
ESLint is a flat-config factory (`createEslintConfig({ react })`) that the root
`eslint.config.mjs` calls once, so lint rules and ignores cannot drift between packages.
`packages/config` depends on its own ESLint plugins instead of hoisting them to the root.

### D30. Formatting, hooks and commit hygiene
Prettier owns layout (ESLint's stylistic rules are disabled through `eslint-config-prettier`);
the config matches the code that already existed (single quotes, 100 columns, trailing commas).
Husky runs `lint-staged`, which lints and formats staged TS/JS; `commitlint` enforces
Conventional Commits on the message. `.editorconfig` pins LF and two-space indentation. No
commit is created automatically — the repository was initialised so the hooks can exist, and
the first commit is left to the team.

### D31. Local dependencies come from compose, but are not required for tests
`db`, `minio` (plus a one-shot `minio-init` that creates `S3_BUCKET` idempotently) and
`mailpit` are the development services; `migrate`, `web` and `worker` still build from the
repo. Unit tests never touch them. Readiness reports them, rather than making the app fail to
boot when storage is down.

### D32. Environment validation is strict and shared
`packages/shared/src/env.ts` validates `DATABASE_URL`, `SESSION_SECRET` (32+ chars),
`S3_*`, `SMTP_*`, `APP_URL`, `LOG_LEVEL` and `NODE_ENV` with Zod and throws once, listing every
offending variable. S3/SMTP are required because document storage and notifications are
core to onboarding; `.env.example` carries working local values and integration tests inject
throwaway ones in `tests/integration/setup-env.ts`. `SESSION_SECRET` is validated now and
reserved for signing future cookie/token payloads — sessions today are random opaque tokens
stored hashed, so the secret is deliberately not used for them.

### D33. One API pipeline in `apps/web/src/server/http`
Envelope helpers, the error hierarchy (`ValidationError`, `UnauthorizedError`,
`ForbiddenError`, `NotFoundError`, `ConflictError`, `ServiceUnavailableError`) and
`withApiHandler` (request id, structured log, error mapping) live in one module.
`lib/api/handler.ts` keeps its authenticated route adapter but delegates id, logging and
error mapping, so the 11 existing routes did not change. `SERVICE_UNAVAILABLE` was added to
the shared error codes for readiness. `src/middleware.ts` assigns `x-request-id` to every
request (including page navigations) and reuses a valid inbound id.

### D34. Tests and CI validate the workflow itself
Every package has a Vitest run (`config`, `db`, `worker` gained their first tests);
`packages/config` parses `.github/workflows/ci.yml` and asserts the lint/typecheck/test/build
steps and the PostgreSQL service. Playwright has a probe smoke test next to the onboarding
flow. CI runs install → prisma generate → migrate → lint → typecheck → tests → build, then a
Playwright job with a MinIO service.

### D35. Foundation schema: snake_case tables, append-only audit, transactional events
`users`, `sessions`, `password_reset_tokens`, `audit_logs`, `outbox_events`,
`idempotency_keys` and `settings` live in snake_case tables and columns (`@@map`/`@map`),
while TypeScript keeps camelCase field names, so no service code changed shape. The migration
renames the existing PascalCase foundation tables in place — no data is dropped — and only
`IdempotencyRecord` is replaced, because replay records are ephemeral.

Ids are uuid v4 through Prisma's `uuid()`: `uuidv7()` needs PostgreSQL 18, and compose and CI
still run 16. Switch to `uuidv7()` when 18 is the floor.

`users.isActive` became `status` (`ACTIVE`/`INACTIVE`/`LOCKED`); `mapUser` derives the domain
`isActive` flag from it, so login and the staff UI are unchanged. Emails are lowercased by the
application and by a `CHECK (email = lower(email))`; `citext` is installed for future
case-insensitive lookups. `pgcrypto` and `pg_trgm` are installed in the same migration.

`audit_logs` is append-only: a `BEFORE UPDATE OR DELETE` trigger raises SQLSTATE `23000`.
Corrections are new rows, and the test suite proves both statements fail. `TRUNCATE` still
works for an owner, which is how the integration suites reset the table — a deliberate escape
hatch for local databases.

`withTransaction`, `writeAudit` and `emitEvent` (`packages/db/src/transactions.ts`) take a
`Prisma.TransactionClient`. Passing the root client throws, so audit and outbox writes cannot
silently escape the transaction that made the change; a failing transaction rolls both back.

`idempotency_keys` keys on `(scope, key)` where scope is `<userId>:<endpoint>`, and stores the
replay payload in `response` (`{ providerId }` for create), replacing the fixed
`(userId, endpoint, key)` tuple. The repository passes that JSON through untouched: the
earlier version packed a domain `resourceId` into the column and unpacked it back, with an
empty string as the failure value. Provider tables keep their original names until the
provider phase, then they get the same treatment.

Single-column indexes that duplicate the leading column of a composite were dropped
(`sessions.user_id`, and `actor_user_id`/`action`/`(entity_type, entity_id)` on
`audit_logs`); the composites answer the same lookups.

Logout revokes rather than deletes: `sessions.revoked_at` is stamped and the row stays for
the audit trail, while `findValidByTokenHash` ignores both revoked and expired sessions.

### D36. Provider data model: relational common data, registry-validated `type_data`
The normalized model (`provider_organizations`, `provider_locations`, `provider_service_pins`,
`provider_contacts`, `provider_licences`, `provider_insurance`, `doctor_profiles`,
`doctor_locations`, `provider_status_history`) sits beside the original flat `providers` table.
The onboarding portal still writes the flat table; new code should target the normalized tables,
and the flat table is removed when the portal is migrated (no data migration is attempted while
both exist).

One organization is one provider type. Common fields are columns; anything only one type asks
for lives in `provider_organizations.type_data`, validated by the registry-derived Zod schema
and stamped with `type_data_schema_version`. `profile_data` holds the publishable profile fields
and `publication_consents` holds per-field consent plus the declarations, because the requested
table list has no declarations entity — see open question 21.

Storage decisions for spec fields that do not map to an obvious column:

| Spec field | Stored in |
|---|---|
| `reg_addr_*`, `reg_city`, `reg_district`, `reg_state`, `reg_pin` | the `provider_locations` row with `is_primary`; `reg_pin` is denormalized to `provider_organizations.primary_pin_code` |
| `sig_*`, `notice_address`, `notice_email`, `contact_*` | one `provider_contacts` row per role (role is part of the unique key) |
| `ins_*` | `provider_insurance` rows |
| `service_pins`, `ph_delivery_pins`, `dc_collection_pins`, `cp_pins` | `provider_service_pins` with `service_kind` = service / delivery / collection (or the care category) |
| `clinic_ce_*`, `ph_licences`, `dc_establishment`, `dc_nabl_details`, `dc_aerb`, `dc_bmw`, `cp_licences` | `provider_licences`, with type-specific extras in `details` |
| file fields | `provider_documents` metadata (binaries stay in object storage) |
| `doc_full_name`, `doc_reg_no`, `doc_reg_council`, `doc_system`, `doc_specialty`, `doc_qualifications`, `doc_photo` | `doctor_profiles` |
| `prac_*` | `doctor_locations` links (one row per practice location) |
| `doc_reg_date`, `doc_reg_valid_to`, `doc_reg_doc` | the `provider_licences` row for the medical registration |

`document_id`, `location_id`, `licence_type_id` etc. reference real tables, so the licence and
insurance rows stay queryable (expiry reminders, admin verification) rather than living in JSON.

**Doctor ownership rule.** `doctor_profiles.organization_id` is required once the profile belongs
to a doctor organization. A clinic-created profile keeps it NULL only while
`created_by_org_id` is set and `doctor_confirmed_at` is NULL; the database enforces exactly that
with `doctor_profiles_organization_rule_check`, so a confirmed doctor always has an owner.

**Uniqueness.** One live doctor per `(registration_no, council_id)` through a partial unique index
(`WHERE deleted_at IS NULL`). Soft-deleting a profile frees the registration for a later
re-registration without deleting history.

**Provider codes.** One sequence per type (`provider_code_seq_doctor`, `_clinic`, `_pharmacy`,
`_diagnostic`, `_care`) and `next_provider_code(provider_type)` formats `CN-DOC-000123` /
`CN-PH-000123`. Code generation is a database call, not an app counter, so concurrent instances
cannot collide.

**Search.** Trigrams (pg_trgm, already installed by the foundation migration) on `legal_name`,
`trade_name`, `mobile` and `registration_number` rather than a maintained `search_vector`:
substring and partial-phone search is what the admin directory needs, and there is no second
column to keep in sync.

**PIN roll-up.** `provider_pin_stats` is a cache keyed by `(pin_code, provider_type, status)`.
`refreshProviderPinStats(db, { pinCodes })` deletes and recomputes only the given PINs; calling it
without PINs rebuilds the table. The provider lifecycle service calls it after status or coverage
changes. `COUNT(DISTINCT organization_id)` means a provider with a primary location and a service
pin in the same PIN is counted once.

**Structural field keys.** The registry contains four keys the spec has no row for:
`locations`, `cp_service_categories` and `dc_tests` (repeater containers for the `loc_*`, `cp_*`
and `test_*` rows) and `clinic_ce_exempt_reason` (named only inside the `clinic_ce_applicable`
Notes cell). `pnpm check:fields` accepts them and lists them separately.

**Registry and spec stay honest.** `pnpm check:fields` parses the spec's key column and compares
it with the registry. It exits 1 on missing keys, and `--strict` also fails on extra ones. Spec
sections 9 (agreement execution), 10 (admin verification) and 11 plus the appendix are out of
scope for this data model and are reported as skipped.

**One executable registry.** `packages/shared/src/fields` is the only place the spec's fields are
defined. `field-registry.ts` is now a projection of it into the legacy `FieldDef`/`SectionDef`
shape the onboarding form and `provider-data.ts` use, so the two cannot drift: `required` maps to
`Y`/`C`/`N`, `excludedFor` to `notRequiredFor`, `adminOnly` fields and `notInProviderForm`
sections (login/account, the clinic-adds-a-doctor sub-form, the admin online-sale switches) are
left out of the provider form. A `select` with no option list projects to free text because the
legacy form has no lookup control. Option lists moved into `fields/options.ts` and are re-exported
from `field-registry.ts`, so imports elsewhere are unchanged.

The merge kept the form's existing field keys for the shapes it stores as JSON
(`practice_locations` with `prac_*` sub-fields, `clinic_fees.item`, `reg_no`, `form_type`,
`issue_date`, `document`) and added the document halves the spec types as "text, file"
(`clinic_bmw_doc`, `clinic_aerb_doc`, `ph_fssai_doc`, `dc_pcpndt_doc`, `dc_bmw_doc`,
`cp_bmw_doc`). Two validation choices follow the spec rather than the old registry:
`trade_name` is required for non-doctor types (section 3.2 marks it `Y`; the old form never asked
for it), and `contact_emergency` stays optional for doctors because the Doctor agreement has no
emergency-escalation contact.

**Provider onboarding API.** `/api/v1/providers` now carries the normalized lifecycle:

- **Transitions** live in `packages/shared/src/provider-lifecycle.ts` as a table of
  `from -> to`, the actors allowed (`owner` staff or `admin`), whether a reason is required and
  whether a full validation pass is needed. Services never compare status strings; submitting an
  approval-stage provider answers `INVALID_TRANSITION`, not "incomplete form".
- **Writes** run through `unitOfWork.transaction`: the status change, `provider_status_history`,
  the audit row and the outbox event commit together, so a reader can never see a transition
  without its trail. Outbox payloads carry ids, type, status and version only.
- **Ownership**: STAFF see only providers they created, and only while the provider is `DRAFT` or
  `CHANGES_REQUESTED`; everything else is 404 and never 403, so the existence of another staff
  member's application is not disclosed. ADMIN see everything and own the review transitions.
- **Section saves** validate only the fields of that section in `draft` mode (types, options,
  formats — never completeness), merge them into `type_data`/columns, bump `version` and return
  the new completeness. Fields stored in a related table are refused with a pointer to their
  sub-resource, which keeps locations, contacts, licences, insurance and service PINs normalized.
- **Completeness** is a pure function of the registry plus the saved rows, so submit, the
  completeness endpoint and the tests agree on what "complete" means. Submitting blocks with the
  report attached.
- **Duplicates**: an exact licence number and an exact doctor registration block (409 with the
  matches); same registration number, same mobile in the same PIN and a trigram-similar legal
  name in the same PIN warn and carry a portal link. An admin can dismiss a warning pair
  (`provider_duplicate_dismissals`), after which it is not shown again.
- **Primary location** writes copy `pin_code`, `district_id` and `state_id` onto the organization
  in the same transaction (skipped when nothing changed, so a save does not bump the version for
  nothing), and clearing the primary location clears them. Because a location save is the only
  place the primary PIN changes, it is also where the same-mobile-in-the-same-PIN warning runs:
  creating or editing the primary location returns the warnings for the new PIN.
- `/api/v1/providers` serves only the normalized model. The portal's flat provider records moved
  to `/api/v1/legacy/providers` (list, create, detail, update, delete, submit, review,
  verifications) and the portal screens call that path, so nothing has to guess a model from the
  request body.
- Duplicate detection on autosave is limited to saves that actually change the registration
  number, mobile, legal name or doctor registration; every other section save skips those queries.

## 2026-11-20 — Document service

- One `documents` table serves both owner models (`owner_type` = `provider` or
  `provider_organization`); `owner_id` is not a foreign key because it points at either table. The
  service resolves the owner and applies the same rule to every read and presign: staff only for
  their own providers (404 otherwise), admins for everything.
- Upload is two-step. `POST /api/v1/documents/upload-url` checks the document type applies to the
  provider, enforces the 10 MB limit and PDF/JPG/PNG allowlist, requires `expires_on` when the type
  tracks expiry, writes a `UPLOADED` row and returns a presigned PUT. `POST /:id/confirm` re-reads
  the object, compares size and SHA-256, and sniffs the magic bytes; a mismatch marks the document
  `REJECTED`, deletes the object and returns 422. The stored mime type is the sniffed one.
- Nothing permanent is ever public: downloads are presigned GETs valid for 5 minutes and every one
  writes an audit row (`document.downloaded`, entity type `document`, identifiers only).
- `ScanProvider` is a hook. The no-op provider is used unless `DOCUMENT_SCAN_ENABLED=true`; a
  confirmed upload then sits in `PENDING_SCAN` until the scanner answers, and an infected result is
  `REJECTED` and removed from storage. The ClamAV provider is still a stub that fails loudly.
- `documents.expires_on` (and `status, expires_on`) are indexed for the Prompt 17 reminder job.
  `DocumentUploader` takes the field-registry `DocumentRequirement` plus its document type, so the
  expiry input appears exactly when the type requires one.

## 2026-11-22 — Doctor and clinic sections (field-spec 4 and 6)

- **Doctor profile is normalized.** `GET/PATCH /api/v1/providers/:id/doctor-profile` writes the
  registry's `doctor_profiles` fields into one live profile row and keeps `doc_reg_date`,
  `doc_reg_valid_to` on the `medical_registration` licence. The registry section validator still
  checks options and types; the profile keeps a `type_data` mirror for the review summary and for
  councils/specialties that are not in master data. `doctor_profiles.council_name` and
  `specialty_name` preserve exactly what the user selected.
- **Practice locations are `doctor_locations`.** Add/edit/remove go through
  `/doctor-practices`; each row carries practice type, linked clinic, address, timings, fee and
  public contact. Clinic links share the table but use `clinic_organization_id`.
- **Clinic establishment licences stay rows.** Clinical establishment, BMW, AERB and other licences
  are written through `/licences` with `details.role`; choosing "exempt" for clinical establishment
  removes its licence row. Certificates remain `provider_documents` roles, so completeness still
  reads the same rows it always did.
- **Section 6.5 is a clinic Doctors step.** Search by registration number + council returns live
  doctor profiles; a duplicate creation is rejected with `CONFLICT` and the existing profile in the
  error details, and the UI offers "Link existing doctor" instead. New profiles are created with
  `status = invited`, `created_by_org_id = clinic`, `organization_id = NULL`, and
  `doctor_confirmed_at = NULL`. They cannot be published until the doctor consents (Prompt 13) and
  an administrator verifies the registration; no publication endpoint exists yet, and the invited
  status is the server-side gate. Removing a clinic doctor deletes only its `doctor_locations` link.
- **Submission rules.** A clinic cannot be submitted without at least one linked doctor and a
  `clinic_incharge` that points at one of those links. The wizard disables Submit for the same
  reason; the API enforces it before the transition.
- Coverage: registry tests assert the doctor/clinic sections and their validation; the integration
  test links one invited doctor to a second clinic without duplicating the profile; the Playwright
  clinic journey adds two doctors through the UI, selects the in-charge and submits to the staff
  list.

## 2026-11-21 — Staff onboarding wizard

- `/staff/providers/new` creates a normalized draft (type, legal name, mobile, primary PIN) after a
  pre-create duplicate check (`POST /api/v1/providers/duplicate-check`). Warnings are advisory: the
  staff member can acknowledge them and create the draft anyway.
- `/staff/providers/[id]/edit` is a step wizard over `formSectionsFor(providerType)`, excluding the
  account section. Section status and progress come from `/completeness`; a failed save marks that
  step "has errors" until it is retried.
- **Data-driven rendering**: the generic renderer covers columns and `type_data` for every field
  type (including money in rupees, pin lists, address + `PinCodeInput`, repeaters, operating hours
  and geo). Conditional visibility/requirement uses the registry's `evaluateCondition`. Related
  rows (registered office, locations, signatory/contacts, insurance, service PINs) have dedicated
  editors that call their sub-resource APIs. `SECTION_EDITORS` is the extension point: a section
  without an entry falls through to the generic renderer, which is why type-specific registry
  sections can be added without UI changes.
- Generic sections autosave on blur and every 20 seconds while dirty. Related editors (registered
  office, locations, contacts, signatory, insurance) register a save with the wizard and autosave the
  same way once they have the fields the API requires; an open location/insurance editor is saved on
  the same 20-second interval. Draft saves send only filled fields, so partial sections never fail
  validation. A successful save clears that step's "has errors" badge. A 409 `VERSION_CONFLICT`
  replaces the form with a reload prompt instead of overwriting.
- **Files feed completeness.** A file field uploads through the document service, then the wizard
  attaches the returned object to `provider_documents` with `role` = the field's registry role (or
  its key when the field has none), replacing any earlier upload for that requirement. This is the
  same role the completeness check reads, so an uploaded file satisfies its requirement.
- **Legal notice contact.** The legal-notice card saves `provider_contacts` role `legal_notice` with
  `provider_contacts.address` (migration `20260422000000_contact_address`); name and phone come from
  the provider's legal name and mobile because the contact API requires both. Addresses are only sent
  once line 1, city, state and a 6-digit PIN are present.
- **Registered-office district.** The wizard maps the selected state name to `state_id`, loads that
  state's districts from master data, and sends the chosen district's `district_id` with the primary
  location. Publication consent declarations are written nested under `declarations` so the
  completeness reader finds each `publication_consents.declarations.*` column.
- The submit path is covered end to end by `apps/web/tests/integration/staff-onboarding.test.ts`,
  which generates every registry requirement for a clinic, submits, and asserts the provider appears
  as `SUBMITTED` in the staff list.
- The review step summarises only editable sections, lists server-reported missing items, and the
  submit button is disabled until completeness passes. After submission the wizard refreshes and
  the form is read-only; the provider appears under `/staff/providers` with its status.
- The staff layout now admits administrators as well (they can own drafts and use the same screens);
  ownership rules still apply in the service layer.

### Type-specific sections (field-spec 5, 7, 8)

- `type-sections.tsx` adds registry-driven editors for the type-specific relations that do not fit
  `type_data`: licence repeaters (`provider_licences` rows keyed by `details.role`), single-licence
  text fields (`ph_fssai`, `dc_bmw`, `dc_pcpndt`), delivery/collection PINs
  (`provider_service_pins` keyed by `storage.role`) and the diagnostic catalogue import. The generic
  renderer still draws every `type_data` field in the same section, so one step shows both halves.
- Licence rows are validated against their registry repeater on write, not only in the form:
  `createLicence`/`updateLicence` merge the stored row with the patch and reject missing required
  sub-fields (form type, scope, validity, certificate) with `VALIDATION_ERROR`. Conditional licence
  rows stay a completeness rule (field-level conditions are evaluated from `type_data`).
- Admin-only fields use the existing `notInProviderForm` section: `ph_online_enabled`,
  `ph_online_categories`, `dc_highrisk_status` and `dc_test_review_flags` live under
  `type_data.pharmacy_admin` / `type_data.diagnostic_admin`. Registry defaults (`false`, `[]`) are
  written on create; `saveSection` rejects those keys for staff and the dedicated admin endpoints
  (`admin-switches`, `highrisk-status`) are the only writers.
- Higher-risk workflows are requested, never enabled, by staff: `dc_highrisk_requests` is a
  `type_data` multiselect, and `submit` seeds a `requested` `dc_highrisk_status` row per request.
  That seeding is the submitter's own write, so the transition compares the freshly loaded version.
- The test catalogue stays in `type_data.dc_tests` (no new table). CSV import merges rows, converts
  rupees to paise, appends prenatal items to `dc_test_review_flags` and refuses sex-determination
  names/codes using `test-blocklist.ts`; every row's outcome is returned as a row-level report and
  the endpoint still succeeds so the operator can fix the file. Duplicate test names are refused.

## 2026-11-21 — Admin provider directory (`/admin/providers`)

**Contract.** `GET /api/v1/admin/providers` is admin-only (`provider.read.all`; staff get
`403 FORBIDDEN`). It takes `page`, `pageSize` (≤100), `sort`, `order` and the filters
`providerType[]`, `status[]`, `pin[]`, `state`, `district`, `onboardedBy`, `createdFrom/To`,
`submittedFrom/To`, `licenceExpiringDays`, `missingDocuments`, `q`. Repeated keys and comma lists are
both accepted. The body is a page of rows plus `meta.total` and `meta.facets` (type and status counts
**under the current filters**, so facets always describe the result set the chips show). Rows carry
provider code, names, type, status, PIN, state/district names, the onboarding staff member, document
count, earliest licence expiry, submitted and created dates.

**Pagination and sorting.** Page-based (`LIMIT/OFFSET`) with a deterministic tiebreaker
(`ORDER BY <sort column> <dir>, o.id ASC`), so a page boundary can never duplicate or drop a row when
many providers share a timestamp. Sorts are limited to a closed enum (`created_at`, `updated_at`,
`submitted_at`, `legal_name`, `status`, `provider_type`, `code`, `primary_pin_code`); the column name
is never taken from user input. A deep offset costs more (`OFFSET 25000` measured 156 ms); a cursor
would remove that cost and is the upgrade path if operators start paging that far.

**PIN filter.** Each entry is 1–6 digits. A 6-digit entry is exact; shorter entries are prefixes, so
`?pin=700001,7000` means "700001 or anything starting 7000". Every entry becomes a `LIKE '…%'`
pattern against `primary_pin_code::text`, served by the expression index with `text_pattern_ops`
(see below). The directory filters on the **primary** PIN, not on every branch/service PIN; the
provider detail page shows the full location and service coverage.

**Text search** uses `ILIKE '%term%' ESCAPE '\'` across `legal_name`, `trade_name`, `mobile`,
`registration_number` and `code`, with `pg_trgm` GIN indexes on each. Reserved characters in the term
are escaped so `%` and `_` are literal.

**Missing documents is a maintained column, not a query.** `provider_organizations.document_gap`
(migration `20260425000100_provider_document_gap`) is true when an always-required
`provider_documents` role is absent, or when a licence type that requires a document has no licence
row or a licence row without `document_id`. It is maintained by triggers on `provider_organizations`
(insert, or `provider_type` change), `provider_documents` and `provider_licences` (insert/update/
delete), so every writer — service, script, migration — keeps it correct. The required set mirrors
the registry (`provider_required_documents()` in SQL); conditional documents are excluded because
their requirement depends on other answers and belongs to the completeness report. This replaced a
per-row document anti-join that measured 195 ms at 100,000 providers and could not use an index.
**When the registry's required documents change, add a migration that replaces
`provider_required_documents()` and re-runs its backfill UPDATE.**

**Licence expiry** is an `EXISTS` over `provider_licences (organization_id, valid_to)`:
`valid_to BETWEEN CURRENT_DATE AND CURRENT_DATE + N`.

### Index map (migration `20260425000000_provider_directory`)

| Filter / sort | Index |
| --- | --- |
| default sort, created range | `provider_org_directory_created_idx (created_at DESC, id) WHERE deleted_at IS NULL` |
| `sort=updated_at` | `provider_org_directory_updated_idx` |
| `sort=legal_name` | `provider_org_directory_name_idx (legal_name, id)` |
| `sort=submitted_at`, submitted range | `provider_org_directory_submitted_idx` |
| `providerType` | `provider_org_directory_type_created_idx (provider_type, created_at DESC, id)`, plus the existing `provider_organizations_provider_type_status_idx` |
| `status` | `provider_org_directory_status_created_idx (status, created_at DESC, id)` |
| PIN exact/prefix | `provider_org_directory_pin_prefix_idx ((primary_pin_code::text) text_pattern_ops) WHERE deleted_at IS NULL` |
| `state` / `district` | `provider_org_directory_state_created_idx` / `provider_org_directory_district_created_idx` |
| `onboardedBy`, staff detail list | `provider_org_directory_creator_created_idx (created_by_user_id, created_at DESC, id)` |
| `licenceExpiringDays` | `provider_licences_org_valid_to_idx (organization_id, valid_to)` |
| `missingDocuments` | `provider_org_directory_document_gap_idx (document_gap, created_at DESC, id)` |
| `q` | five GIN trigram indexes (`legal_name`, `trade_name`, `mobile`, `registration_number`, `code`) |
| row extras | `provider_documents_org_role_idx (organization_id, role)`, `provider_licences (organization_id)` |

All directory indexes are partial on `deleted_at IS NULL`; soft-deleted providers are never scanned.

### EXPLAIN notes (100,553 providers, local PostgreSQL, after `ANALYZE`)

Unfiltered first page — index-only ordering, the joins and the per-row document/expiry lookups only
run for the 25 rows the limit returns:

```
Limit (actual time=0.208..1.155 rows=25)
  -> Nested Loop Left Join
       -> Index Scan using provider_org_directory_created_idx on provider_organizations o (rows=25)
       -> Memoize -> Index Scan using users_pkey
       -> SubPlan 1: Aggregate -> Index Only Scan using provider_documents_org_role_idx (loops=25)
       -> InitPlan 2: Index Only Scan using provider_licences_org_valid_to_idx (loops=25)
Execution Time: 1.4 ms
```

Total count — index-only scan, no heap access worth mentioning:

```
Aggregate (actual time=39.9..40.0 rows=1)
  -> Index Only Scan using provider_org_directory_pin_prefix_idx (rows=100553, Heap Fetches: 8)
Execution Time: 40.0 ms
```

PIN prefix + type + status — two bitmap index scans combined, sort only the 1,476 matching rows:

```
Bitmap Heap Scan on provider_organizations o (rows=1476)
  Recheck Cond: provider_type = 'pharmacy' AND status = 'SUBMITTED'
  Filter: (primary_pin_code)::text ~~ '7000%'
  -> BitmapAnd
       -> Bitmap Index Scan on provider_org_directory_pin_prefix_idx (rows=28042)
       -> Bitmap Index Scan on provider_organizations_provider_type_status_idx (rows=5237)
Execution Time: 12.7 ms
```

Missing documents — the maintained flag turns the anti-join into an index-only scan:

```
Limit (actual time=0.091..0.106 rows=25)
  -> Index Only Scan using provider_org_directory_document_gap_idx on provider_organizations o
       Index Cond: (document_gap = true)
       Heap Fetches: 0
Execution Time: 0.16 ms
```

Facets — one parallel index-only scan and hash aggregate per dimension (type shown; status is the
same shape). Two dimensions run concurrently, so the endpoint pays roughly the larger of the two:

```
Finalize GroupAggregate (rows=5)
  -> Gather Merge (Workers Launched: 2)
       -> Partial HashAggregate Group Key: (provider_type)::text
            -> Parallel Index Only Scan using provider_org_directory_type_created_idx (rows=100553)
Execution Time: 120 ms
```

Text search — a BitmapOr of trigram index scans, one per column:

```
BitmapOr
  -> Bitmap Index Scan on provider_org_directory_legal_name_trgm_idx
  -> ... trade_name / mobile / registration / code trigram indexes
Execution Time: 1.7 ms
```

### Measured timings (median of 5 runs, page 1 of 25)

| Query | Median |
| --- | --- |
| unfiltered | 6.6 ms |
| `providerType=pharmacy` | 4.0 ms |
| `status=SUBMITTED` | 4.0 ms |
| `pin=7000` | 12.7 ms |
| `q=000123` | 5.3 ms |
| `missingDocuments=true` | 5.9 ms |
| `licenceExpiringDays=60` | 14.5 ms |
| type + status + PIN + expiry | 22.8 ms |
| facets (no filters) | 75.3 ms |
| page 1,001 (`OFFSET 25000`) | 155.9 ms |

Every filter combination is under the 300 ms target at 100,000 providers; the slowest path is the
deep offset, not a filter. The figures come from `scripts/seed-provider-directory.ts` plus
`apps/web/tests/integration/directory-performance.test.ts`, which asserts the target.

**Synthetic data.** `pnpm seed:synthetic-providers -- --count=100000` generates providers, documents
and licences for this measurement. Every row is marked (`[SYNTHETIC TEST DATA]` names,
`TEST-SYN-` registration numbers, 
`synthetic-directory-*@test.invalid` staff accounts), the script refuses to run in production, and
`--clean` removes exactly those rows. The perf test is opt-in (`RUN_DIRECTORY_PERF=1`) and skips with
instructions when the dataset is absent.

### UI

- `/admin/providers` is a TanStack Table over the API: column chooser, sortable headers, page-size
  selector and pagination. Filters live in the URL (chips show what is active and remove themselves),
  so a view is a shareable link. Saved views (`provider_directory_views`, per user, unique by name)
  store that same query string; saving an existing name overwrites it. Views are personal: the delete
  endpoint is scoped to the owner and another admin gets `404`.
- The PIN input accepts several PINs and prefixes in one box (`700001, 7000`) and rejects anything
  that is not 1–6 digits. Invalid input is reported inline and nothing is applied.
- Bulk selection is per page and exists **only** for export: "Export selected" / "Export page" build
  a CSV in the browser. There is deliberately no bulk mutation.
- A row click opens `/admin/providers/[id]`; links and controls inside a row do not trigger it.
- `/admin/providers/[id]` renders a summary header (status badge, provider code, type, PIN, staff
  link, completeness), duplicate warnings from the existing duplicate service, a missing-document
  list, and tabs: one read-only tab per registry section (columns, `type_data`, related rows such as
  licences, locations, contacts and coverage), Documents (presigned preview, generated server-side
  with a 10-minute TTL), Licences (expiry badges), Status history and Audit timeline. Review actions
  are visible but disabled until the review endpoints land (Prompt 16).
- The staff detail page (`/admin/staff/[id]`) lists the providers that person onboarded, newest
  first, linking into the directory detail page.

### Tests

- `apps/web/tests/integration/admin-directory.test.ts` — filter combinations (type/status/PIN
  exact+prefix, onboarded-by, created and submitted ranges, licence expiry, missing documents, text
  search across name/mobile/registration/code), facet counts, pagination consistency across three
  pages, staff refusal at both the service and the HTTP route (403), and per-user saved views.
- `apps/web/tests/integration/directory-performance.test.ts` — the 100,000-row target, opt-in.
- Fixtures are isolated by PIN prefix `7999` and `IT-DIR-` registration numbers, and are removed in
  `afterAll`.

## 2026-11-21 — Provider analytics per PIN (read model, APIs, `/admin/analytics`)

Administrators need to see how many providers are onboarded in each PIN. Three measures answer
three different questions, and they must never be added together.

### Definitions

- **Providers in a PIN** (`primary`): a provider counts once, for the PIN of its **primary
  location** (`provider_organizations.primary_pin_code`, kept in step with the primary
  `provider_locations` row). Additional branches do not add counts, and service areas are not
  locations. This is the number used by the PIN table, the top-N chart and coverage gaps.
- **Doctors practising in PIN** (`doctor_practice`): one count per active doctor practice location,
  at that location's PIN. A doctor linked to a clinic (a `doctor_locations` row with a
  `clinic_organization_id`) practises at the clinic's primary PIN instead. This is a separate
  measure: a doctor is also a provider in its own primary PIN, and both statements are true.
- **Providers serving PIN** (`service`): one count per `provider_service_pins` row — the areas a
  provider delivers to or serves. Reported on its own; it is not coverage of the primary PIN.

Soft-deleted providers (`deleted_at`) contribute nothing to any measure.

### Read model

- `provider_pin_stats (pin_code, provider_type, status, measure, count)` is the roll-up. The
  primary key includes `measure`, so the same PIN can hold different numbers for the three
  questions.
- `provider_pin_contributions (measure, subject_id, pin_code, organization_id, provider_type,
  status)` remembers what each organisation currently contributes. `subject_id` is the
  organisation for `primary`/`service`, and the doctor profile for `doctor_practice`.
- The worker consumes every `provider.*` outbox event with aggregate type
  `provider_organization` and recomputes that organisation's contributions, diffing the live state
  against the ledger and applying `+1`/`-1` to the stats table in one transaction. Replays are
  idempotent, a PIN move subtracts the old row and adds the new one, and a delete removes exactly
  what was added before. A new event, `provider.updated`, is emitted when the primary location PIN
  changes, because that write does not otherwise announce itself.
- `pnpm db:rebuild-stats` truncates both tables and recomputes them from the live tables in one
  transaction. It is the repair path after seeding or a manual data fix.
- A nightly pg-boss job (`pin-stats-consistency-check`, 02:15) recomputes live counts and compares
  them with the read model, logging `pin_stats_drift_detected` with the total and a sample of the
  differing rows. It only logs; the repair is the rebuild command. Drift is expected only after
  out-of-band writes (a hard delete cascades the ledger but cannot touch the counts).

### APIs

- `GET /api/v1/admin/analytics/pin-summary` — rows of `pin_code`, state, district, total and
  approved, plus counts per provider type and per status. Filters: provider type, status, state,
  district, `onboardedBy`, created date range, and a PIN prefix (`q`). `groupBy=pin|district|state`
  drives the drill-down; `measure=primary|doctor_practice|service` selects which definition the
  rows answer (default `primary`); `gapsOnly=true` returns directory PINs with no approved
  provider and is primary-only.
- `GET /api/v1/admin/analytics/overview` — totals, the Draft → Submitted → Approved funnel (current
  drafts, providers that ever submitted, providers that ever approved), average review time
  (submission to approval, in days), provider-type mix and onboarding per day.
- `GET /api/v1/admin/analytics/staff-performance` — per staff member: created, ever submitted,
  approved, currently rejected, and average days from creation to approval.
- Totals and staff performance count every live organisation, including one that has not set a
  primary PIN yet. Only the per-PIN summary requires a PIN, because a row needs one; the doctor
  practice and service measures derive their PIN from the practice/service rows instead.
- `GET .../pin-summary/export` — the same view as CSV (capped at 5000 rows).

The summary reads `provider_pin_stats` when the request only needs type/status/PIN-prefix (the
`read_model` source). State, district, owner and date filters are not dimensions of the read model,
so those requests aggregate the live tables with the same primary-PIN definition (`live` source).
Both paths return the same shape.

### UI

- `/admin/analytics` (admin only, `provider.read.all`; staff see neither the page nor the APIs) has
  KPI cards, the funnel, onboarding per day, the top-8 PINs as stacked type bars, a sortable and
  searchable PIN table, state → district → PIN drill-down, a coverage-gap list and CSV export.
  A three-way selector switches the PIN table, top chart and CSV between providers in PIN, doctors
  practising in PIN and providers serving PIN. Clicking a PIN opens `/admin/providers?pin=…`, the
  existing filtered directory. Coverage gaps stay on the primary measure.
- Charts are CSS bars: no charting dependency was added.
- The heatmap/map is deliberately skipped: `pin_codes` has latitude/longitude columns but no row in
  the current directory has coordinates (0 of 19,459), so a map would be empty. If coordinates are
  imported later, the same summary can feed it.

### Tests

- `packages/db/tests/integration/pin-stats.test.ts` — create, status change, primary PIN move,
  delete (including a replayed event), the separate service measure, and rebuild output equal to
  the incremental output.
- `provider-model.test.ts` — the model-level measure assertions.

## Admin review workflow (field spec §10)

### Data

- `verification_records` now holds `organization_id` or `doctor_profile_id` (exactly one), an
  item code (`registration`, `qualification`, `drug_licence`, `establishment_licence`, `nabl`,
  `pcpndt`, `aerb`, `bmw`, `insurance`, `address`, `signatory_authority`, `consent`, …), status
  (`PENDING|VERIFIED|REJECTED|EXPIRED|NOT_APPLICABLE`), `verified_by`, `verified_at`, free-text
  `source`, `evidence_ref`, `reason` and `next_verification_on`. The legacy flat-provider
  verification table was renamed to `legacy_verification_records` in the same migration.
- `review_comments` keeps one thread per registry section, `review_assignments` the reviewer who
  took a provider, and `review_settings` the SLA thresholds (defaults 48 h warning, 72 h breach;
  a singleton `default` row).
- `provider_status_history` gained `scope`, `scope_ref_id`, `scope_label` and
  `flagged_sections` so a suspension records what it covers and a change request records which
  sections need work.
- Checklist items are generated at submit from `requiredVerificationItemsFor(type)` in
  `packages/shared/src/review.ts`, which derives required vs optional from the field registry's
  document requirements. A clinic's linked doctors get their own registration/qualification rows.

### Behaviour

- `GET /api/v1/admin/review` lists SUBMITTED and already-opened UNDER_REVIEW providers oldest
  first with type/PIN/staff/assigned-to-me filters and SLA badges; `POST .../[id]/assign` takes a
  provider into the reviewer's queue. `GET .../settings` and `PUT .../settings` manage the ageing
  thresholds.
- `GET /api/v1/admin/review/[id]` returns the side-by-side data sections, documents, checklist
  progress, assignment, comments, allowed decisions and suspension scope options.
  `PATCH .../verifications/[item]` records a status, source, evidence, reason and re-verification
  date; `POST .../comments` adds a section note.
- `POST .../decisions` accepts `approve`, `request_changes`, `reject`, `suspend` and `reinstate`.
  Every decision first moves SUBMITTED → UNDER_REVIEW (when needed) and then applies the Prompt 7
  transition, so audit rows and outbox events are written by the same state machine as any other
  status change. Approval is refused while a required item is not VERIFIED/NOT_APPLICABLE;
  request-changes requires at least one section and a comment (the comment is copied into each
  flagged section's thread); reject, suspend and reinstate require a reason. Suspension scope is
  the whole profile, one location or one service category, validated against the provider's own
  rows.
- Re-verification: while an application is CHANGES_REQUESTED, staff edits to a section, licence,
  insurance policy, location or doctor profile reset only the checklist items that depend on it
  (`verificationItemsForSection`), so unaffected checks stay verified.
- The onboarding staff member receives an email for every decision, and the per-section comments
  appear with the change-request banner in the staff wizard (and in the staff provider list's
  change-request note).
- `/admin/review` and `/admin/review/[id]` are admin-only (`provider.review`); the provider record
  links into the same review screen.

### Tests

- `apps/web/tests/integration/review.test.ts` — approval blocked by pending required items, the
  change-request round trip (verify → request changes → staff fixes a licence → affected item
  resets → resubmit → re-review), and suspension scope (location validation, history scope,
  reinstate).

## Event-driven system (Section: connecting modules through events)

The reference is `docs/events.md`; this section records why the pieces look the way they do.

### Catalogue

- `packages/shared/src/events.ts` is now a catalogue rather than a bare string union: each entry
  has a version, a Zod schema and a description. `outboxEventVersions` is derived, and the
  publisher validates every payload before running a handler. Retired names
  (`provider.under_review`, `provider.consent.*`, `provider.licence.expiring`, the
  `provider.review.*` variants) stay in the catalogue so stored rows remain readable;
  `canonicalEventType()` maps them to the catalogue names.
- New events written by the services: `provider.review_started` (UNDER_REVIEW transition),
  `provider.reinstated` (SUSPENDED → APPROVED), `document.uploaded` (confirm),
  `document.verified` (admin review) and `doctor.linked_to_clinic` (clinic link). Consent events
  now use `consent.captured`/`consent.revoked`.

### Publisher

- `apps/worker/src/publisher.ts` keeps the existing `SELECT … FOR UPDATE SKIP LOCKED` claim, then
  runs every interested handler once per event. Handler progress is recorded in
  `processed_event_handlers` `(event_id, handler)`, and every handler is written to be idempotent
  because a crash can occur between the work and the marker.
- Failures back off exponentially (10s doubling, capped at 15 minutes). After
  `OUTBOX_MAX_ATTEMPTS` (5) the row is dead-lettered (`dead_lettered_at`) and stops being claimed.
  `dead_lettered_at` is added to `outbox_events` with an index; the claim predicate excludes it.
- Dead letters surface on `/admin/system/events` with a Retry action that clears the marker,
  resets attempts and writes an audit row.

### Handlers

- `pin-stats` recomputes `provider_pin_stats` through the existing diff-based path, so replay is a
  no-op.
- `search-index` refreshes `provider_search_index` from live tables (code, type, status, PIN,
  city, doctor count) — denormalized fields recomputed, never adjusted by a delta.
- `notifications` writes in-app rows and sends email through the SMTP interface. In-app creation
  is idempotent through `(user_id, type, event_id)`. Email is deliberately at-least-once: a
  duplicate compliance reminder is preferable to a missing one.
- `webhook-deliveries` writes one `webhook_deliveries` row per matching active endpoint; delivery
  is a separate pg-boss job so a slow subscriber never delays the outbox. `consumer-aggregator`
  forwards the envelope when `AGGREGATOR_WEBHOOK_URL` is set.

### Notifications

- `notifications` and `notification_preferences` are ordinary tables; no preference row means the
  catalogue default in `packages/shared/src/notifications.ts`. The same catalogue drives the
  preferences screen, so a new notification type cannot exist without a preference row.
- The header bell polls `/api/v1/notifications/unread` every minute; `/notifications` lists both
  roles' own rows and every read/write is scoped to the session user, never to a client id.

### Jobs

- pg-boss schedules document/licence expiry (02:00), PIN-stats check (02:15), session prune
  (03:00), outbox cleanup (03:30), stale-draft reminders (04:00) and webhook delivery (every
  minute). The expiry job reads reminder days from `document_types.expiry_reminder_days` and uses
  60/30/7 for licences; a reminder event is deduped per `(subject, day count)`, and expiry sets
  the document EXPIRED, raises `provider_organizations.compliance_flag` and writes
  `document.expired` once.
- Every job writes a `job_runs` row (status, duration, summary, error) shown on
  `/admin/system/jobs`. Jobs are idempotent and multi-instance safe; the dedupe keys make the
  second instance's work a no-op.

### Tests

- `apps/worker/tests/integration/events.test.ts` — retry backoff and dead-letter after the attempt
  budget, successful publish with handler markers, handler idempotency on replay (notification
  count unchanged) and the expiry scan driven by a fake clock (reminder at day 7, single event on
  rerun, EXPIRED + flag after the date). The publisher tests claim with a 2020 clock so they never
  touch events the running worker has queued.

## 2026-11-22 — Asynchronous CSV exports

Listing pages export through a queued job rather than a synchronous download, so a large result
set never has to fit in a web request or in memory.

### Request and generation

- `POST /api/v1/exports` validates `{ type, filters }` against the same schemas as the listing
  endpoints (`providers`, `pin_summary`, `staff_performance`, `expiring_documents`) and writes a
  `QUEUED` row to `export_jobs` with the requester, filters, `expires_at` and an audit entry. The
  response is 202; the CSV does not exist yet.
- The worker's `export-jobs` queue (every minute) claims the oldest queued row with
  `FOR UPDATE SKIP LOCKED`, so several workers drain it safely; a job left `RUNNING` by a crashed
  worker is reclaimed after 15 minutes.
- Each type is read page by page (500 rows) from the same repository queries as its listing.
  Rows are serialised with `csvChunks` and piped to a temp file, then uploaded as a stream with a
  known content length. At no point is the whole file a string in memory. The web app never
  proxies the bytes.
- The finished file is recorded in `export_files` (private S3 prefix `exports/<job>/`), the job
  becomes `SUCCEEDED` with `row_count`, and the requester gets an in-app `export.ready`
  notification whose body carries the stable `/api/v1/exports/:id/download` link. That route checks
  session, ownership and expiry, audits the download, and redirects to a five-minute presigned GET.
- `expires_at` is set from `EXPORT_RETENTION_HOURS` (24 by default). The daily `export-cleanup`
  job marks expired jobs `EXPIRED` and deletes the objects; the row stays for history.

### Safety and scope

- `exportColumnMaps` is the one column list per type; it excludes document names, binaries,
  consent declarations and every other piece of evidence. Adding a column is a deliberate change
  to that map.
- CSV formula injection: a cell whose first non-space character is `=`, `+`, `-` or `@` is
  prefixed with an apostrophe before quoting. Files start with a UTF-8 BOM so Excel reads them
  correctly.
- Authorization: administrators may export every type. Staff may export only `providers`, and the
  service writes `onboardedBy = actor.userId` into the stored filter; the worker re-applies that
  owner scope, so neither a crafted request nor a tampered row can widen it. Staff asking for any
  other type get 403, and admin-only filters on a staff request are rejected with 422.
- Limits: `countActive` allows one queued/running export per account (409 otherwise), and
  `EXPORT_MAX_ROWS` (50,000) aborts the job with a "narrow the filters" message instead of writing
  an oversized file. A failed job is visible on `/exports`.

### UI and tests

- Export buttons sit on the provider directory, the staff provider list and the analytics cards
  (PIN summary, staff performance). `/exports` lists the caller's jobs with status, rows, expiry
  and a download link, and polls while something is still generating.
- `packages/shared/src/exports.test.ts` covers formula prefixes, quoting, the BOM and a 50,000-row
  streamed file; `apps/worker/tests/integration/exports.test.ts` covers owner scope, formula
  escaping, a 600-row streamed export, the row cap, a staff non-provider request and TTL cleanup;
  `apps/web/tests/integration/exports.test.ts` covers 202 queueing, the audit row, 409 for a second
  job, 403/422 for staff, admin exports and per-requester history.
