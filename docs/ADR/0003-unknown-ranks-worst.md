# ADR-0003: UNKNOWN road status ranks worse than BLOCKED

**Status:** accepted · **Date:** 7 October 2026 · **Phase:** 0 · **Spec:** 12.3, 13.2

## Context

The spec defines six access statuses (8.3) and, in 12.3, a functional colour for
each. It does not specify their ordering, and it gives no rule for how to render
a road whose status nobody has verified.

That gap is the whole decision. Six statuses have to be collapsed to a single
"worst access" figure per ward, in `v_ward_summary.worst_access_rank`, so the
panel summary and the map can both answer "how bad is access here". Four orderings
are defensible on paper; one of them is dangerous.

## Decision

```sql
CREATE FUNCTION ops.access_rank(p_status ops.access_status) RETURNS integer
  SELECT CASE p_status
    WHEN 'OPEN'       THEN 1
    WHEN 'RESTRICTED' THEN 2
    WHEN '4WD_ONLY'   THEN 3
    WHEN 'DAMAGED'    THEN 4
    WHEN 'BLOCKED'    THEN 5
    ELSE 6              -- UNKNOWN
  END;
```

**UNKNOWN (6) ranks above BLOCKED (5).** "Worst" is a `min()` over the rank, so
UNKNOWN produces the highest-numbered, most-constrained result.

## Rationale

The two plausible orderings that put UNKNOWN lowest are:

- **UNKNOWN = 0, "least known".** Renders as the safest thing on the map.
- **UNKNOWN = 5, tied with BLOCKED.** Renders as equally bad as a confirmed
  washout.

Both are wrong for the same reason: **a driver reads the map, not the data.**

A confirmed BLOCKED segment has been assessed. There is a report saying the road
is gone, a reason recorded, and someone who looked. A driver who sees it stops
and reroutes.

An UNKNOWN segment means nobody has reported on it. It may be fine. It may be the
one crossing that took the bridge out. The absence of information is not
information, and rendering it as low-priority is the exact failure mode that
loses a vehicle.

So UNKNOWN sorts as *more* constrained than BLOCKED. A ward containing an
unverified segment reads as needing attention rather than as clear. The
alternative errs toward caution, which is the correct direction for a road-status
display during a flood response.

There is a secondary benefit: `NULL` and `UNKNOWN` then behave consistently.
The views default to rank 6 when no segment exists nearby, so "no data" and
"unverified" read the same way. A location with no roads near it does not claim
to be accessible.

## Why the rest of the order is what it is

- **BLOCKED (5) above DAMAGED (4).** Both are impassable in practice, but BLOCKED
  is a positive statement that the road cannot be used, whereas DAMAGED implies
  passable with difficulty. If a summary must pick one to escalate on, escalate
  the absolute.
- **4WD_ONLY (3) below DAMAGED.** A 4WD vehicle can still make it. A damaged road
  may be impassable to any vehicle.
- **RESTRICTED (2).** Open to some traffic, closed to heavy.
- **OPEN (1).** No constraint.

The ordering is not "how good is the road" but "how likely is this to stop a
convoy", which is why 4WD_ONLY sits above RESTRICTED: a light vehicle gets
through, a loaded truck does not.

## Enforcement

One ordering, in one place, mirrored in TypeScript:

- `ops.access_rank()` in migration 0003, with `ops.v_access_status_lookup` so the
  legend, the filter dropdown and the map cannot disagree on names or order.
- `accessRank` in `packages/schemas/src/enums.ts`.
- `verify_migration.sql` check 13 asserts `UNKNOWN > BLOCKED > DAMAGED > …` in the
  database.
- Unit tests assert the same ordering and that all six ranks are distinct.

## Consequences

- **The ordering is load-bearing and must not be "tidied".** Reordering it to
  make `min()` read naturally, or to make "worst = BLOCKED" more intuitive,
  would render unverified roads as the safest thing on the map. The comment in
  `accessRank` says so.
- **`worst_access_rank` is nullable-free.** Views default it to 6, so consumers
  never branch on NULL.
- **The UI must not colour UNKNOWN as neutral.** Line style already carries the
  status independently (dotted, `--status-unknown`); the legend shows the dash
  pattern, not just the swatch, so the distinction survives greyscale printing and
  colour-vision deficiency.