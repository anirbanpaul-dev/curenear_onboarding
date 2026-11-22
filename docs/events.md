# Domain events

CureNear is wired together through an outbox. Every state change that another part
of the system cares about writes an `outbox_events` row **in the same database
transaction** as the change. The worker publishes those rows to internal handlers,
which keep the read models, notifications and webhooks in step.

Nothing reads another module's tables "by hand" for these flows: the event is the
contract.

## The catalogue

The catalogue lives in `packages/shared/src/events.ts`. Every entry has a version
and a Zod schema; `outboxEventVersions` is derived from it, and the publisher
validates each payload before running a handler.

| Event | Version | Aggregate | Payload |
| --- | --- | --- | --- |
| `staff.created` | 1 | `staff` | `staffUserId`, `role`, `actorUserId`, `active?`, `deleted?`, `changedFieldKeys?` |
| `staff.deactivated` | 1 | `staff` | Same as `staff.created` |
| `provider.created` | 1 | `provider_organization` | `organizationId`, `providerType`, `status`, `recordVersion`, `actorUserId`, `reason?`, `changedFieldKeys?` |
| `provider.updated` | 1 | `provider_organization` | Same as `provider.created` |
| `provider.submitted` | 1 | `provider_organization` | Same as `provider.created` |
| `provider.review_started` | 1 | `provider_organization` | Same as `provider.created` |
| `provider.changes_requested` | 1 | `provider_organization` | Same as `provider.created` (with `reason`) |
| `provider.approved` | 1 | `provider_organization` | Same as `provider.created` |
| `provider.rejected` | 1 | `provider_organization` | Same as `provider.created` (with `reason`) |
| `provider.suspended` | 1 | `provider_organization` | Same as `provider.created` (with `reason`) |
| `provider.reinstated` | 1 | `provider_organization` | Same as `provider.created` (with `reason`) |
| `provider.terminated` | 1 | `provider_organization` | Same as `provider.created` (with `reason`) |
| `document.uploaded` | 1 | `provider_organization` / `provider` | `documentId`, `ownerType`, `ownerId`, `documentTypeCode`, `expiresOn`, `actorUserId` |
| `document.verified` | 1 | `provider_organization` / `provider` | Same as `document.uploaded` |
| `document.expiring` | 1 | `provider_organization` | `subjectType` (`document`/`licence`), `subjectId`, `organizationId`, `documentTypeCode?`, `expiresOn`, `daysLeft` |
| `document.expired` | 1 | `provider_organization` | Same as `document.expiring` |
| `consent.captured` | 1 | `provider_organization` | `providerId`, `consentId`, `consentType`, `method`, `actorUserId` |
| `consent.revoked` | 1 | `provider_organization` | Same as `consent.captured` plus `publicationPermissionOff?` |
| `doctor.linked_to_clinic` | 1 | `provider_organization` | `organizationId`, `doctorProfileId`, `clinicLinkId`, `actorUserId` |

### Minimum data

Payloads carry identifiers, status and structural metadata only. Names, emails,
mobiles and document contents are added by `assertEventPayloadIsSafe`, which
throws when a payload key looks like personal data. Handlers that need contact
details look them up server-side.

### Deprecated names

Older code paths still write a few retired names. They stay in the catalogue so
already-stored rows remain readable, and `canonicalEventType()` maps them:

| Stored name | Canonical name |
| --- | --- |
| `provider.under_review` | `provider.review_started` |
| `provider.review.approved` | `provider.approved` |
| `provider.review.changes_requested` | `provider.changes_requested` |
| `provider.review.rejected` | `provider.rejected` |
| `provider.consent.captured` | `consent.captured` |
| `provider.consent.revoked` | `consent.revoked` |
| `provider.licence.expiring` | `document.expiring` |

## Delivery

`apps/worker/src/publisher.ts` is the publisher:

1. `claimBatch` selects up to `OUTBOX_BATCH_SIZE` unpublished, non-dead rows whose
   `next_attempt_at` has passed, using `SELECT … FOR UPDATE SKIP LOCKED`. The
   claim increments `attempts` and can run from several worker instances at once
   without handing the same row to two of them.
2. The payload is validated against the catalogue schema for the canonical type.
3. Every registered handler whose `handles(type)` returns true runs once. Before
   running, the publisher checks `processed_event_handlers`; after running it
   writes the `(event_id, handler)` marker.
4. The event is marked published (`published_at`, `last_error = null`).

On failure the row is re-scheduled with exponential backoff (10s doubling, capped
at 15 minutes). When `attempts` reaches `OUTBOX_MAX_ATTEMPTS` (default 5) the row
is **dead-lettered**: `dead_lettered_at` is set and the publisher stops claiming
it. Dead letters appear first on **Admin → System events**; **Retry** clears the
marker and resets the attempt counter so the next tick picks the event up again.

## Handlers

All handlers live in `apps/worker/src/handlers` and are idempotent, because a
crash between the work and the marker replays the event.

| Handler | Events | Effect |
| --- | --- | --- |
| `pin-stats` | `provider.*` (except verification updates and delete) | Recomputes `provider_pin_stats` for the organization; the incremental path diffs `provider_pin_contributions`, so a replay is a no-op |
| `search-index` | `provider.*`, `doctor.linked_to_clinic` | Refreshes `provider_search_index` (code, type, status, PIN, city, doctor count) from live tables |
| `notifications` | Every notification type (see `notifications.ts`) | Writes in-app rows and sends email through the SMTP interface, honouring per-user preferences |
| `webhook-deliveries` | Everything | Writes one `webhook_deliveries` row per matching active endpoint (Prompt 20) |
| `consumer-aggregator` | Everything | Posts the envelope to `AGGREGATOR_WEBHOOK_URL` when configured |

### Notification idempotency

`notifications` is unique on `(user_id, type, event_id)`, so replaying an event
cannot duplicate a bell entry. Email is at-least-once: a crash after SMTP accepted
a message but before the handler marker was written sends it again. A missing
compliance reminder is worse than a duplicate, so this trade-off is deliberate.

### Webhook delivery

Endpoints are registered by an administrator on **Admin → System events →
Webhook endpoints**: an https URL, optionally narrowed to a comma-separated list
of event types (blank or `*` receives everything). Unknown event names are
rejected so a typo cannot subscribe to nothing. `POST`/`GET
/api/v1/admin/system/webhooks` and `DELETE .../webhooks/[id]` back the screen and
write an audit row.

Endpoint matching copies the envelope into `webhook_deliveries` (unique per
endpoint and event) and returns; a separate job (`webhook-deliveries-dispatch`,
every minute) POSTs pending rows with exponential backoff and marks them `FAILED`
after `WEBHOOK_MAX_ATTEMPTS`. Subscribers must de-duplicate on the envelope `id`.

## Scheduled jobs

Jobs run under pg-boss and are safe to run on several instances: every write is
idempotent and every event they emit has a dedupe key.

| Queue | Schedule | What it does | Events written |
| --- | --- | --- | --- |
| `outbox-dispatch` | every minute (+ poll loop) | Publishes the outbox | — |
| `document-expiry-scan` | 02:00 daily | Reminds on configured days, expires past `expires_on`, flags the provider, clears resolved flags | `document.expiring`, `document.expired` |
| `pin-stats-consistency-check` | 02:15 daily | Compares the PIN read model with live counts and logs drift | — |
| `session-prune` | 03:00 daily | Deletes expired sessions | — |
| `outbox-cleanup` | 03:30 daily | Deletes published events older than 30 days and dead letters older than 90 days | — |
| `stale-draft-reminders` | 04:00 daily | Reminds owners of drafts untouched for `STALE_DRAFT_DAYS` (7) | — (writes notifications directly) |
| `webhook-deliveries-dispatch` | every minute | Delivers pending webhook rows | — |

Reminder days come from `document_types.expiry_reminder_days`. Licences use a
fixed ladder of 60/30/7 days. A reminder is written once per (subject, day count);
re-running the scan on the same day inserts nothing.

Every run writes a `job_runs` row (status, duration, summary, error) which is
listed on **Admin → Job history**.

## Notifications

`notifications` holds `user_id`, `type`, `title`, `body`, `entity_type`,
`entity_id` and `read_at`. The header bell shows the unread count, and
`/notifications` lists them for both staff and administrators.

`notification_preferences` stores per-user choices per type (`in_app`, `email`);
a missing row means the catalogue default in
`packages/shared/src/notifications.ts`. The same catalogue drives the
`/notifications/preferences` screen.

Email templates are rendered by `renderNotificationEmail`, which produces the
subject and body and links back to the portal. The SMTP transport is the same
interface the portal uses for password mail.

## Adding an event

1. Add the entry (version, schema, description) to `eventCatalogue`.
2. Emit it inside the transaction that made the change, with a stable `dedupeKey`
   where a retry is possible.
3. Add a handler rule if it needs a read-model, notification or webhook effect.
4. Document it in the table above.

Never change a shipped payload in place: add optional fields (safe for consumers)
or a new event with an incremented version.
