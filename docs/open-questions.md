# Open questions

Questions raised while implementing `docs/CureNear_Provider_Onboarding_Field_Spec.md`. Each
one was resolved with the most conservative option for now; the choice is noted so it can be
revisited without re-reading the code.

## Blocking product decisions (owner: client / counsel)

1. **Pharmacy online sale.** Which categories and prescription workflows may be enabled
   (spec 7.5)? Portal captures interest only; `ph_online_enabled` stays `false` with no admin
   endpoint to change it yet.
2. **Clinic agreement.** No template exists. Clinics currently accept platform terms only;
   `agr_version`/`agr_template` are not collected.
3. **Clinic-added doctors.** The portal models clinic ↔ doctor as clinic-entered practice
   locations (`doctor_practice.practice_locations`), not as a separate `doctor_profile` created
   by a clinic with OTP confirmation. Confirm whether Section 6.5 needs its own entity and
   invitation flow.
4. **One login, several provider types.** Spec 11.2 item 4 is unresolved. Not modelled: each
   provider record stands alone; there is no "person owns a doctor profile and a clinic"
   linkage.

## Field-level questions

5. **Conditional (`C`) fields.** Prose conditions in the spec are only partly encoded. Which
   `C` fields must become mandatory for each provider type? Implemented conditionals are listed
   in `docs/decisions.md` D6; the rest are optional on submit.
6. **Agreement, declarations and privacy versions.** Sections 3.9 and 9.2 require storing
   version, timestamp, IP and user for each declaration, plus agreement acceptance and e-sign.
   This iteration stores the eight common declarations as booleans inside the provider payload
   and records the audit row; agreement templates, versions, e-sign and witness data are not
   implemented. Confirm the legal requirement before building them.
7. **Public field consent.** `public_fields` is a multiselect over a fixed option list
   (`publishableFieldKeys`). The specification says the provider ticks each field, which
   literally means hundreds of options; confirm the intended granularity.
8. **Grouped fields modelled as repeaters.** `dc_nabl_details`, `dc_tests`, `dc_packages`,
   `ph_licences` and similar groups have no sub-keys in the spec. Structural keys were
   introduced (see D7). Confirm names before they appear in a public contract.
9. **`loc_geo` capture.** A map picker is required by the spec; the form currently accepts
   latitude/longitude numerically. Confirm whether a map provider is needed and which one.
10. **Document uploads.** Metadata only, no binary storage or malware scanning (D9). Confirm
    storage target, retention and whether documents must be downloadable in the portal.
11. **Expected documents per type.** The spec requires "registration certificate" etc., but the
    accepted document count per licence is unspecified. Current schema allows one metadata
    record per file field.

## Operational questions

12. **Reminder automation.** Spec 10 asks for reminders at 60/30/7 days and optional
    auto-suspension on expiry. The worker emits `provider.licence.expiring` events; no email
    channel exists and no provider is auto-suspended. Who receives reminders, and should
    suspension be automatic?
13. **Suspension and termination endpoints.** Statuses exist and transitions are defined, but
    no UI/API drives `suspend`, `terminate`, `publish` or `live`. Confirm the workflow and who
    may trigger it.
14. **Rate limiting and lockout.** Login is not rate limited and there is no password reset or
    MFA. Needed before production exposure.
15. **Session lifetime.** 12 hours by default (`SESSION_TTL_HOURS`). Confirm against internal
    security policy.
16. **Analytics depth.** Coverage analytics currently count providers by status/type/PIN and
    scan up to 500 records for expiring licences. Confirm required reports (per staff member,
    per district, time-to-approval).
17. **Aggregator contract.** Event names, envelope and versioning are our proposal. Confirm
    with the consumer app team; the `version` field in each event allows additive changes.
18. **State default.** State defaults to West Bengal but the select covers all states/UTs, and
    licence authority is free text, so other states work without schema change (spec decision
    8). Confirm no state-specific validation is required.

## Infrastructure questions

19. **Document uploads.** Documents are still metadata-only; when binaries are stored in the
    MinIO/S3 bucket, should the browser upload via presigned PUT (direct to storage) and who
    owns retention/object lifecycle? Bucket is provisioned now so this can be answered
    without re-platforming.
20. **`SESSION_SECRET` usage.** Sessions currently use opaque random tokens stored as SHA-256
    hashes, so the secret is unused. If signed cookies or JWT sessions are adopted, define the
    rotation policy (previous-secret overlap window) before enabling it.

## Provider data model questions (Prompt 14)

21. **Declarations storage.** The requested table list has no declarations entity, so the eight
    common declarations are stored under `publication_consents.declarations` and the clinic /
    pharmacy declarations in `type_data`. Confirm whether declarations deserve their own table
    with version, user, IP and timestamp per acceptance.
22. **Registrant name and auth secret.** `registrant_name` is a `user` field and `auth_secret` is
    the login credential, so neither is in `provider_organizations`. Confirm the portal shows the
    account's name rather than a separately captured registrant name.
23. **Insurance applicability.** Which provider types must carry which insurance is prose in
    sections 3.6, 5.1, 6.3, 7.3 and 8.4; the registry marks the fields conditional without a
    machine-checkable condition. Confirm the required types per provider.
24. **Clinic biomedical waste and AERB.** Section 6.1 makes both conditional on facts the form
    does not ask for (waste generation, radiation equipment). Either add a trigger question or
    make the licence optional — needs a product decision.
25. **Diagnostic AERB.** Same gap as 24 for section 8.1: nothing records whether radiation
    equipment is on site.
26. **Doctor registration renewal.** `doc_reg_valid_to` is conditional "where the council requires
    renewal"; the council master list does not carry that flag yet.
27. **Specialty requirement.** `doc_specialty` is marked `C` with no stated condition; treated as
    required when a specialty is claimed.
29. **`prac_establishment_licence`.** The spec gives it two types (text and file); modelled as a
    licence number with the document in `provider_licences`.
30. **`profile_approved_on`.** A system field set by admins; stored in `profile_data.approved_on`
    until the approval workflow owns it.
31. **Structural sub-keys.** Repeater sub-keys the spec leaves implicit (`dc_tests`, `dc_packages`,
    `dc_subprocessors`, `cp_staff_quals`, `cp_staff_regs`, `cp_supervisor`, `ph_pharmacists`,
    `ph_courier_details`, licence groups) are proposed names. Confirm before they appear in a
    public contract.
32. **Conditions that cross storage.** A conditional field stored in a related table (for example
    `ph_delivery_pins` in `provider_service_pins`, `clinic_ce_*` in `provider_licences`) cannot be
    enforced by the `type_data` JSON schema; the service that writes those rows must enforce it.
    Confirm the service boundary when the provider service is built.
33. **Agreement and privacy sections.** Sections 9.1 and 9.2 (agreement execution, privacy
    versions) are not part of this data model. Confirm where acceptance records live before the
    e-sign work starts.
35. **Completeness for licence-backed fields.** A required licence/document is treated as present
    when a `provider_licences` row exists (matched by `details.role`) and, for required licence
    documents, when that row has a `document_id`. Whether "one row per licence type" or "any row
    with the right role" is the real rule still needs the clinic/PCPNDT checklist.
37. **ClamAV scanning.** `DOCUMENT_SCAN_ENABLED=true` selects a stub that refuses uploads until the
    clamd INSTREAM client, a running scanner and a failure policy (block vs manual review) exist.
    Decide where the scanner runs before production.
38. **Document ownership integrity.** `documents.owner_id` cannot be a foreign key while the table
    serves two owner models. Ownership is checked by the service; if that is not enough, add
    per-owner link tables or a trigger.
39. **Document lifecycle.** `EXPIRED` is in the status enum but only the Prompt 17 reminder job can
    set it; the rule for re-uploading an expired document (replace in place vs new row) is not
    decided yet.
40. **Catalogue identity and import limits.** `dc_tests` rows are matched by trimmed, case-folded
    test name for duplicates; there is no stable test code identity, no maximum file size and no
    streaming parse. Confirm the de-duplication key and the largest catalogue operators will upload.
41. **Sex-determination matching.** The blocklist is a set of name/code patterns in
    `packages/shared/src/test-blocklist.ts` (PC-PNDT wording), not an exhaustive regulator list. It
    runs on import and on the repeater, but an unusual spelling can still pass for admin review to
    catch. Confirm whether a legal-reviewed list should replace the patterns.
42. **Workflow status ownership.** `dc_highrisk_status` is written by the admin endpoint only; there
    is no audit entry per decision beyond `decided_by`/`decided_at` in the stored row and the
    provider audit log. Confirm whether each approval needs its own audit/notification record.
