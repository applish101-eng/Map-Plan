# Data dictionary

Reference for the schema created by migrations `packages/db/migrations/`. Names
here match the database exactly. For rationale and prohibitions, see
[`ARCHITECTURE.md`](../ARCHITECTURE.md) §8 and [`ADR/`](ADR/).

Current state: **schema complete, no data.** Boundary ingestion is Phase 1; demo
data is Phase 2. Every table below is empty except the lookup tables.

---

## Schemas

| Schema | Holds | Mutable |
|---|---|---|
| `baseline` | Stable reference geography — admin areas, roads, waterways, facilities, aliases | By import, versioned |
| `ops` | Volatile situational data, workflow records, imports | Continuously |
| `app` | Identity, organisations, data-driven lookups, migration bookkeeping | By configuration |
| `audit` | Append-only change log | Never (revoked) |

Baseline and situational data are kept separate (spec principle 5) so that a
boundary refresh does not invalidate situational history, and so road *status* can
expire without the road's *alignment* changing.

---

## Roles

| Role | Grants | Notes |
|---|---|---|
| `migrator` | Owns everything | DDL only. `DATABASE_MIGRATOR_URL`. |
| `app_rw` | SELECT/INSERT/UPDATE/DELETE on `baseline`, `ops`, `app`; SELECT-only on `audit` | Application runtime. `NOINHERIT`. Owns nothing, so it cannot bypass a trigger. |
| `tiles_ro` | SELECT on `baseline`, `ops` only | Martin's connection. Cannot see `audit` or `app.users`. |

`NOINHERIT` on both application roles means a session cannot pick up elevated
rights through role inheritance.

`audit.audit_log` is `SELECT`-only for `app_rw` **including Admins** — admins can
export, nobody can edit. `UPDATE`, `DELETE` and `TRUNCATE` are revoked from
`PUBLIC`, `app_rw` and `tiles_ro`, and the revocation is repeated in migration
0002 so a database restored from a dump ends up append-only.

---

## `baseline`

### `admin_areas`

Province → district → municipality → ward in one self-referencing table.
A single table (rather than four) is what lets the API answer "which ward contains
this point" with one indexed lookup, and lets the filter cascade traverse the
same shape as the data.

| Column | Type | Null | Notes |
|---|---|:--:|---|
| `id` | `uuid` | no | PK, `gen_random_uuid()` |
| `level` | `smallint` | no | 0 country, 1 province, 2 district, 3 municipality, 4 ward. CHECK 0–4 |
| `parent_id` | `uuid` | no\* | FK self. CHECK: `level = 0 OR parent_id IS NOT NULL` |
| `pcode` | `text` | yes | Authoritative code, UNIQUE across all levels |
| `name_en` | `text` | no | |
| `name_ne` | `text` | yes | Devanagari. **No source found** — see DATA_SOURCES.md |
| `ward_number` | `smallint` | yes | Level 4 only |
| `municipality_type` | `text` | yes | Metropolitan / Sub-metropolitan / Municipality / Rural Municipality |
| `source` | `text` | no | Dataset + publisher. Mandatory: ward provenance varies |
| `source_version` | `text` | yes | |
| `retrieved_at` | `date` | yes | |
| `geom` | `geometry(MultiPolygon,4326)` | no | WGS84 per AD-9 |

\* Nullable at level 0 only.

**Constraints**

- `admin_areas_ward_consistent` — `(level = 4) = (ward_number IS NOT NULL)`.
  Catches a half-filled ward row at import rather than in a map layer.
- `admin_areas_parent_required` — a non-country row must have a parent.

**Indexes** — GiST on `geom`; btree on `parent_id`, `level`; trigram GIN on
`name_en` and `name_ne`.

**Population.** Expected 7 provinces, 77 districts, 753 local units. COD-AB
publishes 775 at level 3; the extra 22 are protected areas and must be filtered
by `Type_GN` (see ADR-0004).

### `roads`, `waterways`, `facilities`

Baseline geometry with an `osm_id` for upsert on re-import. **Not yet ingested.**
`roads` and `waterways` are `LineString`; `facilities` is `Point` with
`facility_type` and nullable `ward_id`.

### `admin_aliases`

Place-name spelling variants for field data (risk R4, spec Phase 4). Created empty
so the import engine can target it without a later migration. Unique on
`(admin_area_id, alias, language)`.

---

## `app`

### `organisations`

| Column | Type | Notes |
|---|---|---|
| `name` | `text` | UNIQUE |
| `short_name` | `text` | |
| `org_type` | `text` | INGO / NGO / GOV / UN / COMMUNITY / OTHER |
| `is_primary` | `boolean` | Plan International |

**`organisations_single_primary`** is a partial unique index on `((is_primary))`
WHERE `is_primary`, so exactly one primary organisation can exist. That is what
makes the "Plan International only" filter a single click rather than a query that
might return two rows. A CHECK cannot enforce cross-row uniqueness; a partial
unique index can.

Seeded: Plan International Nepal (primary), Nepal Red Cross Society, UNICEF, WFP,
Local Government.

### `users`

| Column | Type | Notes |
|---|---|---|
| `email` | `citext` | UNIQUE, case-insensitive |
| `display_name` | `text` | |
| `role` | `app.user_role` | ADMIN / EDITOR / VIEWER, default VIEWER |
| `organisation_id` | `uuid` | FK organisations |
| `is_active` | `boolean` | Soft deactivation; does not delete history |
| `deleted_at` | `timestamptz` | Soft delete |

No credential material here. Password hashes go in a separate table in Phase 5,
so this row holds identity and role and nothing sensitive.

### `auth_sessions`

Auth.js database sessions: `user_id` (cascade delete), `expires_at`. Indexed on
both.

### Lookups

Data-driven rather than enums (AD-8), so a new response type is a data insert
rather than a migration and redeploy.

| Table | Seeded | Key columns |
|---|---|---|
| `categories` | 9 | `code` PK — FOOD, WATER, HYGIENE_WASH, SHELTER_NFI, HEALTH, PROTECTION, EDUCATION, CASH_VOUCHER, OTHER |
| `item_types` | 31 | `category_code` FK, `default_unit`, unique per (category, label) |
| `activity_types` | 11 | `code` PK |
| `location_types` | 15 | `code` PK, `icon` → `packages/icons` |

`item_types.default_unit` matters for imports: when a source file gives a
quantity with no unit, the item's default is used rather than rejecting the row.
Spec 14.3 treats an unknown unit as a WARNING, not an ERROR.

`location_types.icon` names a shape from `packages/icons` (spec 11.7). Shape, not
colour, is what carries meaning, so these survive greyscale printing.

### `schema_migrations`

`version`, `applied_at`, `checksum` (SHA-256), `duration_ms`. The runner refuses
to proceed if an applied file's checksum has changed — editing a merged migration
is exactly the failure this detects (spec 19.9).

---

## `ops`

### Provenance columns

Repeated on every operational table rather than factored into a supertype. An
enforced NOT NULL column per table is the only way "every operational record has
provenance" is guaranteed; an inheritance mixin would let a table silently lack
it.

| Column | Type | Notes |
|---|---|---|
| `source` | `text` | Free text. Demo rows must use `'DEMO DATA — not real'` |
| `source_organisation_id` | `uuid` | FK organisations |
| `source_url` | `text` | |
| `reported_at` | `timestamptz` | When reported |
| `verified_at` | `timestamptz` | When verified |
| `verified_by` | `uuid` | FK users |
| `verification_status` | `ops.verification_status` | NEW / REVIEW / VALID / NOT_VALID / EXPIRED. NOT NULL, default NEW |
| `confidence` | `ops.confidence_level` | LOW / MEDIUM / HIGH |
| `notes` | `text` | Free text — privacy warning applies (spec 16.3) |
| `is_demo` | `boolean` | NOT NULL, default false. **Every demo row must set this** |
| `created_at` / `created_by` | `timestamptz` / `uuid` | |
| `updated_at` / `updated_by` | `timestamptz` / `uuid` | |
| `deleted_at` | `timestamptz` | Soft delete (AD-10) |
| `geometry_derived` | `boolean` | Where applicable. `locations` only |

### `locations`

The core entity. One row per village, ward office, distribution point, facility,
bridge or hub.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `external_id` | `text` | Source-system id. Partial UNIQUE where live |
| `name` / `name_ne` | `text` | `name_ne` nullable — no source yet |
| `location_type` | `text` | FK `app.location_types` |
| `ward_id` | `uuid` | FK admin_areas level 4. Derived on write |
| `municipality_id` | `uuid` | FK level 3. Derived on write |
| `district_id` | `uuid` | FK level 2. Derived on write |
| `province_id` | `uuid` | FK level 1. Derived on write |
| `geom` | `geometry(Geometry,4326)` | Point normally; polygon allowed |
| `description` | `text` | |
| `operational_status` | `text` | Free text |
| `geometry_derived` | `boolean` | **True when geom came from a ward centroid, not reported coordinates.** Never set silently (spec 8.6) |

Four separate hierarchy columns rather than one `admin_area_id`, because almost
every filter groups at district or municipality level.

`external_id` uniqueness is partial (`WHERE deleted_at IS NULL`) so a soft-deleted
row's id can be reused by a corrected re-import.

### `population_records`

Ward-level, point-level or polygon affected-population figures. **A time series**:
`as_of_date` is NOT NULL and views take the latest, so the panel can show "was
412, now 428".

| Column | Type | Notes |
|---|---|---|
| `location_id` / `ward_id` | `uuid` | At least one required |
| `geom` | `geometry(Geometry,4326)` | Optional affected-area polygon |
| `affected_people` | `integer` | CHECK ≥ 0 |
| `affected_households` | `integer` | CHECK ≥ 0 |
| `children` | `integer` | Optional breakdown |
| `older_people` | `integer` | Optional breakdown |
| `people_with_disabilities` | `integer` | Optional breakdown |
| `severity` | `smallint` | CHECK 1–5 |
| `as_of_date` | `date` | NOT NULL |

**Constraints**

- `population_records_anchor` — at least one of `location_id`, `ward_id`, `geom`.
  Without it a row could never be rendered or found again.
- `population_records_hh_le_people` — `households <= people`.
  Spec 14.3 makes this an import WARNING; this is the backstop *after*
  acknowledgement. A warning the user can dismiss is a suggestion; a constraint
  is a guarantee (see ADR-0005).

### `interventions`

One response activity: an assessment, a distribution, a WASH intervention.

| Column | Type | Notes |
|---|---|---|
| `external_id` | `text` | Partial UNIQUE on `(organisation_id, external_id)` |
| `activity_date` | `date` | NOT NULL |
| `organisation_id` | `uuid` | NOT NULL, FK organisations |
| `location_id` | `uuid` | NOT NULL, FK locations |
| `ward_id` | `uuid` | Denormalised for grouping |
| `activity_type` | `text` | FK `app.activity_types` |
| `beneficiaries` | `integer` | CHECK ≥ 0 |
| `households_reached` | `integer` | CHECK ≥ 0 |
| `delivery_status` | `ops.delivery_status` | PLANNED / IN_PROGRESS / COMPLETED / CANCELLED |
| `geom` | `geometry(Geometry,4326)` | |

Upsert key is `(organisation, external_id)`, not `external_id` alone: two
organisations may legitimately use the same activity id in their own source
systems.

### `distribution_items`

Item-level distributions — the product's most distinctive table.

| Column | Type | Notes |
|---|---|---|
| `intervention_id` | `uuid` | NOT NULL, FK cascade delete |
| `category_code` | `text` | FK categories |
| `item_type_id` | `uuid` | FK item_types, nullable |
| `item_label` | `text` | NOT NULL. Free-text fallback so "other" always works |
| `quantity` | `numeric(14,2)` | NOT NULL, CHECK ≥ 0 |
| `unit` | `text` | NOT NULL |
| `beneficiaries` / `households_reached` | `integer` | May differ from the parent intervention |

**`unit` is part of the aggregation grouping key** in
`v_distribution_totals`. A query therefore cannot sum 1,250 kg with 6,000 L —
not because a developer remembered the rule, but because the result set has no
row in which that sum is expressible. See ADR-0005.

### `road_segments`

| Column | Type | Notes |
|---|---|---|
| `road_name` | `text` | NOT NULL |
| `route_id` | `uuid` | FK routes |
| `from_location_id` / `to_location_id` | `uuid` | FK locations |
| `access_status` | `ops.access_status` | NOT NULL, default UNKNOWN |
| `reason` | `text` | Why it is that status |
| `last_verified` | `timestamptz` | Drives "recently changed" |
| `geom` | `geometry(LineString,4326)` | NOT NULL |
| `baseline_road_ref` | `text` | Optional link to the baseline road layer |

Status lives here, not on `baseline.roads`: access expires, the road's alignment
does not.

**`access_status` ordering is load-bearing.** `ops.access_rank()` returns 6 for
UNKNOWN and 5 for BLOCKED. An unverified road is operationally more dangerous
than a known-blocked one, because a driver will attempt it. Rendered the other
way, unverified roads display as the safest thing on the map. See ADR-0003.

### `road_status_history`

Written by trigger, not by a route handler, so a status change cannot be written
without its history — the same guarantee as the audit log. `from_status`,
`to_status`, `reason`, `source`, `changed_by`, `changed_at`.

### `routes`

Ordered operational corridor: `name`, `description`, `is_demo`.

### `hazard_areas`

Situational and time-stamped: `hazard_type`, `observed_at`, `severity`,
`geom(MultiPolygon,4326)`. Polygon because an extent is an area, not a point.

### `reports` · `attachments`

`reports` supports the verification workflow (spec 15.1). `payload` is `jsonb`
and **immutable** — the review flow never updates it, so "what the field team
actually reported" cannot drift. `promoted_entity_type` / `promoted_entity_id`
record what a VALID report became.

`attachments` is polymorphic on `(entity_type, entity_id)`. Deliberately not a
foreign key per type: one index serves every entity type, and duplicating the
table per type would gain nothing at query time. `sha256` gives integrity and
duplicate detection; `file_key` is an object-storage key, never a filesystem path.

### `imports` · `import_rows` · `import_mapping_templates`

The staged, resumable import pipeline (AD-6, spec 14).

`imports.status` ∈ UPLOADED, MAPPED, VALIDATED, COMMITTED, FAILED, ROLLED_BACK.

`import_rows` retains **every** row including errors, so committing only the valid
rows is never a silent drop (spec 14.4). Partial index on `severity = 'ERROR'` for
the error-CSV export.

`import_mapping_templates` stores a column mapping per organisation, so the same
spreadsheet layout is not remapped for every upload.

---

## `audit`

### `audit_log`

| Column | Type | Notes |
|---|---|---|
| `occurred_at` | `timestamptz` | NOT NULL, default now() |
| `actor_id` | `uuid` | **Soft reference, not FK.** A deleted user must not cascade away what they did |
| `actor_label` | `text` | Denormalised so the name survives deletion |
| `table_name` | `text` | Schema-qualified |
| `record_id` | `uuid` | NOT NULL |
| `action` | `text` | INSERT / UPDATE / DELETE / RESTORE |
| `changed_fields` | `jsonb` | `{ field: { old, new } }`, whitelisted fields only |
| `old_row` / `new_row` | `jsonb` | Full row snapshots |
| `import_id` | `uuid` | Links a write to its import job |
| `request_id` | `text` | Correlates with request logs |

Written by `audit.log_change()` on 13 tables. `changed_fields` is restricted to a
whitelist of user-visible fields, so `updated_at` never generates noise and an
UPDATE that changes nothing writes no row. A soft-delete transition is labelled
`DELETE`/`RESTORE` rather than appearing as an anonymous field change.

**Append-only.** `UPDATE`, `DELETE`, `TRUNCATE` revoked from `PUBLIC`, `app_rw`
and `tiles_ro`.

---

## Views

Read models (spec 8.5). The API and Martin consume these rather than recomputing
joins, so map, panel, table and dashboard cannot diverge.

### Functions

| Function | Returns | Notes |
|---|---|---|
| `ops.counts_toward_totals(status)` | `boolean` | `status = 'VALID'`. Official totals are VALID-only |
| `ops.access_rank(status)` | `integer` | 1 OPEN … 5 BLOCKED, **6 UNKNOWN**. See ADR-0003 |

### `ops.v_location_latest_population`

Most recent population record per location, ordered by `as_of_date` then
`created_at` so a same-day re-report supersedes rather than ties ambiguously.

### `ops.v_ward_summary`

One row per ward. Drives the choropleth. Notable columns:

| Column | Caveat |
|---|---|
| `affected_people` / `affected_households` | Latest VALID record, else latest unverified |
| `is_verified` | Whether the population record is VALID |
| `reached_people_sum` | **Sum of per-activity beneficiary counts. May double-count the same person across activities (risk R3). Never label this "unique people reached".** |
| `quantity_total_mixed_units` | Sum across categories *and* units. Display with a mixed-unit caveat only |
| `worst_access_rank` | `min(access_rank)` over segments within 2 km |
| `last_updated` | **NULL when a ward has no activity.** `admin_areas` has no `created_at`, so consumers treat NULL as "never" rather than reading a fabricated timestamp |

### `ops.v_distribution_totals`

Aggregates per ward/municipality/district × category × item × unit ×
organisation. **`unit` is in the grouping key**, so quantities are never mixed.

### `ops.v_location_profile_headline`

The always-visible summary block from spec 13.2: admin chain, latest population,
activity and distribution counts, worst access, report count, provenance.
Deliberately not the whole profile — `/locations/:id/profile` assembles the rest.

### `ops.v_affected_locations`

Point-level affected features, so the choropleth and the point layer agree on
verification handling.

### `ops.v_road_segments_current`

Current status plus `recently_changed` (true within 24 h), so freshly reported
access can be distinguished from week-old status in the panel and on the map.

### `ops.v_access_status_lookup`

Code, human label and rank in one place, so the legend, the filter dropdown and
the map cannot disagree about status names or ordering.

### `ops.v_freshness`

Newest operational change across all tables. Surfaced as `meta.data_freshness`
(spec 10.1) and on printed maps (spec 13.8).

---

## Verification

`packages/db/scripts/verify_migration.sql` runs 15 structural assertions against
live PostGIS. Run with `pnpm db:verify`.

Checks: extensions · schemas · audit triggers on all 13 tables · audit
immutability · `tiles_ro` restrictions · `NOINHERIT` · spatial indexes valid ·
read models present · lookups seeded · single primary organisation · boundaries not
fabricated · no leaked demo data · UNKNOWN ranks worst · totals require VALID ·
migrations recorded.

Each returns `passed` as a boolean plus a `detail` string explaining a failure.
The DB-agnostic rules are also asserted in `tests/acceptance.phase0.test.ts`, so
drift between the SQL function and its TypeScript mirror fails the build.