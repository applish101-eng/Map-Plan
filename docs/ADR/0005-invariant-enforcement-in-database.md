# ADR-0005: Enforcement in the database, not in application code

**Status:** accepted · **Date:** 7 October 2026 · **Phase:** 0 · **Spec:** 8.5, 8.6, 14.3, 16.1

## Context

The specification states several rules as prohibitions on developers:

- "Never add quantities with different units" (8.5)
- "Only `VALID` records count toward official totals" (8.5)
- "Reached people are **not** summed into unique people reached" (8.5, risk R3)
- "Households > people" is an import WARNING (14.3)
- "Enforcement: server-side checks in every route handler… **never rely on UI
  hiding**" (16.1)
- "A generic `audit.log_change()` trigger is attached to every `ops.*` table" (8.4)

The spec does not say *where* these rules live. That choice decides whether they
hold.

## Decision

**Wherever a rule must hold for every consumer, put it in the database.**

### Aggregation grouping

`v_distribution_totals` groups on:

```sql
GROUP BY …, di.category_code, c.label, di.item_label, di.unit, o.id, o.name, o.is_primary
```

`unit` is part of the grouping key, so a query *cannot* sum 1,250 kg of rice with
6,000 L of water — not because a view author remembered the rule, but because
the result set has no row in which that sum is expressible.

### Totals scope

```sql
CREATE FUNCTION ops.counts_toward_totals(p_status ops.verification_status)
  RETURNS boolean IMMUTABLE AS $$ SELECT p_status = 'VALID'; $$;
```

Used as a `FILTER` clause in every aggregate. Widening to include unverified
records is a deliberate change to one function, and the UI already has a toggle
for it — so there is no path that silently mixes verified and unverified figures.

### Impossibility as a constraint

```sql
CONSTRAINT population_records_hh_le_people CHECK (
  affected_households IS NULL OR affected_people IS NULL
  OR affected_households <= affected_people
)
```

Spec 14.3 makes households > people a WARNING, which the import surface
implements as an acknowledgement prompt. The CHECK is the backstop *after* that
acknowledgement: even a user who explicitly confirms the anomaly cannot write the
row. A warning the user can dismiss is a suggestion; a constraint is a
guarantee.

Similarly:

```sql
CONSTRAINT admin_areas_ward_consistent CHECK ((level = 4) = (ward_number IS NOT NULL))
CONSTRAINT admin_areas_parent_required CHECK (level = 0 OR parent_id IS NOT NULL)
CONSTRAINT organisations_single_primary UNIQUE (is_primary) WHERE is_primary
```

The last is what makes "Plan International only" a single click rather than a
query that might return two rows. It is a partial unique index rather than a
CHECK because a CHECK cannot enforce cross-row uniqueness.

## Rationale

These rules have four consumers: the map layers, the API, the data table and the
dashboard. Any rule implemented in one consumer is a rule the other three do not
have.

The failure mode is not loud. A dashboard that sums 1,250 kg and 6,000 L and
renders "7,250" looks like a working dashboard. A ward summary that averages
across verified and unverified records looks like a slightly different number
each time someone edits a record. Neither announces itself, and both would be
found by a humanitarian user comparing our figure against their own — which is
exactly the credibility loss this product cannot afford.

PostgreSQL also happens to be the right tool rather than a convenient one. Every
one of these rules is expressible as a constraint or a grouping key, which is not
true of arbitrary invariants; this one was unusually well suited.

## Where the database is the wrong place

Two rules deliberately stayed in application code:

**Free-text privacy warnings** (spec 16.3) — "Do not enter names, phone numbers
or personal addresses" is a prompt, not a guarantee. A `CHECK` with a regular
expression against Nepali names would produce false positives and could be
bypassed by formatting variants. The UI warns; the review step catches.

**Upload column heuristics** (spec 16.3) — flagging columns named `phone`,
`citizenship`, `mobile` operates on the shape of a spreadsheet, before there is
a row. Nothing in the schema can see it.

Both are guidance for humans. Encoding them as constraints would create false
certainty about a problem that is fundamentally about human behaviour.

## Consequences

- **The database is the specification.** A reviewer can read the migrations and
  know the invariants, without reading TypeScript. That is also the reason
  `verify_migration.sql` exists as SQL rather than as unit tests: 15 structural
  assertions executed against live PostGIS.
- **Migrations become the contract.** Changing a rule means a migration, which
  means a reviewed `.sql` diff. Slower than editing a service function, and that
  is the point.
- **Some rules are asserted in three places** — SQL function, TypeScript mirror,
  and test. `access_rank` is the clearest case (see ADR-0003). The duplication is
  deliberate: the SQL is authoritative and the TypeScript exists so the UI can
  sort and label without a round trip. Each has a test that fails if the other
  drifts.
- **The immutable-migration rule (spec 19.9) now bites.** Changing a constraint
  means a new migration, never an edit to `0001`. The runner enforces this with a
  checksum comparison and exits non-zero on a mismatch.