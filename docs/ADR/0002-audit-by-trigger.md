# ADR-0002: Audit by database trigger, not application logging

**Status:** accepted · **Date:** 7 October 2026 · **Phase:** 0 · **Spec:** 8.4, AD-7

## Context

Spec 8.4 requires an audit log that "cannot be bypassed by a code path that
forgets to log", and AD-7 chooses a database trigger over application-supplied
logging for that reason. Spec 15.3 requires specific entries to be displayable in
the History tab, for example `affected_people 412 → 428`.

Two implementation questions are not settled by the spec:

1. **What counts as a change?** A naive `to_jsonb(NEW) - to_jsonb(OLD)` diff
   records `updated_at` on every single write. Every record then looks edited,
   and the History tab becomes noise no one reads.
2. **Who made the change?** A trigger cannot see the HTTP session. It has to be
   told.

## Decision

**A generic `audit.log_change()` trigger on 13 tables, with three rules.**

### 1. A whitelist of diffable fields

```sql
c_record_id text[] := ARRAY[
  'id', 'external_id', 'name', 'name_ne', 'access_status', 'status',
  'activity_date', 'as_of_date', 'severity', 'operational_status',
  'quantity', 'unit', 'item_label', 'affected_people', 'affected_households',
  'beneficiaries', 'households_reached', 'verification_status', 'confidence',
  'reason', 'source', 'title', 'description', 'accessibility'
];
```

A field appears in the History tab only if it is on this list. `updated_at` is
therefore excluded structurally rather than by remembering to filter it. When an
UPDATE produces an empty diff, the trigger returns `NULL` and writes nothing — so
a save that changes nothing produces no audit row.

The list is deliberately short. It covers exactly what the product shows a user:
who, when, which field, old → new. Diagnostic columns (`is_demo`, foreign keys
used only for joins) are excluded because no user reads them.

### 2. Actor context via transaction-scoped settings

The API sets, at the start of every write transaction:

```sql
SELECT audit.set_actor($1::uuid, $2, $3, $4::uuid);
```

which does `set_config('app.actor_id', …, true)` — `local = true`, so the value
is transaction-scoped and cannot leak between pooled connections. `packages/db`
wraps this in `withTransaction()`, which is the only supported write path.

`actor_label` is denormalised into the log so a deleted user's name survives:
`audit_log.actor_id` is a soft reference, not a foreign key, because a cascade
delete must not erase the record of what someone did.

`current_setting('app.actor_id', true)` returns NULL when unset, so a direct
`psql` edit still logs — with a null actor — rather than failing.

### 3. Soft deletes are labelled, not disguised

An UPDATE that only moves `deleted_at` writes `action = 'DELETE'`. Moving it back
writes `action = 'RESTORE'`. Without this, every soft delete renders in the
History tab as an anonymous field change, which is the least useful possible
record of a deletion.

## Why not application logging

The spec's own reasoning is decisive, and it is worth restating because the
alternative is genuinely tempting: a `logger.audit(...)` call in a service layer
is easier to test, easier to read, and does not require a trigger function per
table.

It is also exactly the thing that gets bypassed. The realistic failure is not
malice, it is a refactor — someone adds a bulk-update path, forgets the log call,
and the History tab shows a value that changed with no record of who changed it.
That failure is silent and would not be discovered until someone needed the audit
trail. A trigger cannot be skipped, because it is not part of the call path.

The cost is that audit writes are not unit-testable without a database. Accepted:
the spatial logic cannot be meaningfully tested without PostGIS either, and
`verify_migration.sql` asserts the trigger is present on all 13 tables.

## Consequences

- **An UPDATE with no whitelisted change writes nothing.** Intentional: it is
  what keeps the History tab readable. Tracked in `changed_fields` as `{}` and
  suppressed by returning `NULL`.
- **Trigger functions cannot be unit-tested in isolation.** Coverage comes from
  `verify_migration.sql` check 3, which asserts a trigger is attached to each of
  the 13 tables.
- **Adding a user-visible field means adding it to `c_record_id`.** A forgotten
  entry produces a change that is persisted but invisible in the History tab.
  The list is a short, readable list precisely so this is visible in review.
- **`audit_log` is `SELECT`-only for `app_rw`, including Admins.** Admins can
  export (spec 15.3); nobody can edit. Revoked from `PUBLIC`, `app_rw` and
  `tiles_ro`, and re-asserted in the migration so a restored-from-dump database
  ends up append-only.
- **`road_segments` also has its own `road_status_history` trigger.** The generic
  audit log records `access_status RESTRICTED → BLOCKED`; the domain-specific
  table records it as a navigable history for the Access tab (spec 15.3). Doing it
  in a trigger means a status change cannot be written without its history —
  the same guarantee as the audit log itself. A first draft tried to link the two
  rows via `audit_log_id` in the same transaction, but trigger ordering between
  two `AFTER` triggers on the same table is alphabetical by name and therefore not
  a contract; the link was dropped rather than left as a value that would be null
  half the time.