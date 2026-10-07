# Nepal Flash-Flood Response GIS — Phase 0 plan and status

Written before any code, per spec 19.1. Phase 0 only; see
[Phase status](#phase-status) for what is and is not done.

The governing document is `docs/ARCHITECTURE.md` (the full specification).
This file records what Phase 0 actually built, the assumptions made, and the
decisions that need a human.

---

## What Phase 0 delivers

| Acceptance criterion (spec 17, Phase 0) | Result |
|---|---|
| `docker compose up` yields a running DB with extensions | Pass — PostGIS 3.4, `pg_trgm`, `unaccent`, `pgcrypto`, `citext` all present |
| `pnpm dev` serves a shell using the brand tokens | Pass — HTTP 200, all three brand tokens present in the served CSS |
| CI green | Pass — lint, typecheck, 51 unit tests, migration verification, build, contrast check |
| Monorepo, tooling, env config, design tokens | Done |
| Martin tile server, MinIO, Postgres in compose | Done; MinIO is opt-in (see [Deviations](#deviations)) |

Verification commands:

```bash
pnpm db:up        # PostGIS + Martin
pnpm migrate      # 4 migrations
pnpm db:verify    # 15 structural checks, all must report passed = t
pnpm typecheck
pnpm lint
pnpm test          # 51 tests
pnpm test:tokens   # brand contrast, spec 12.2
pnpm build
pnpm dev           # http://localhost:3000
```

---

## The stack decision, and what was rejected

The brief asked whether this could be plain HTML, CSS and JavaScript.

**A static front end could carry most of what a user sees**: the map, the
eight-tab location profile, filters, search, distribution grouping, road-status
styling, the design system. MapLibre and Turf are plain JS, and roughly 70% of
the product is presentation.

**It could not carry the parts the specification treats as load-bearing:**

| Requirement | Spec | Why the browser cannot do it |
|---|---|---|
| Audit that cannot be bypassed | 8.4, AD-7 | "Cannot be bypassed by a code path that forgets to log" requires the guarantee to live in the database. Application logging is exactly the thing the spec is rejecting. |
| "Never rely on UI hiding" | 16.1 | Client-side RBAC is not authorisation. A Viewer who opens devtools can call any endpoint. |
| `ST_Within` ward assignment, `ST_DWithin` proximity, ward aggregation across ~7,500 wards | 8.6, 8.7 | Needs spatial indexes. Doing it per-client is a performance cliff, not an optimisation. |
| "Never add quantities with different units", enforced in aggregation | 8.5 | Must hold for the API, the table, the dashboard and the tile server. A view-level guarantee cannot. |
| Resumable versioned imports, jobs, MVT serving | AD-4, AD-6, 14 | Server concerns. |

So the specified stack stands. Cost: one `docker compose up` and one `pnpm dev`.
What was trimmed is ceremony, not substance — plain pnpm workspaces, no
Turborepo, no Nx, no monorepo framework. See ADR-0001.

---

## Assumptions

Stated explicitly because each one, if wrong, changes real work.

1. **Node 25 locally, targeting Node 20+.** `engines` declares `>=20.11`; the
   spec asks for 20 LTS. Node 25 satisfies it, and CI runs 22. Next 15 requires
   18.18+. No Node-20-specific syntax is used.
2. **Single-host deployment.** Compose is the local and small-deployment story.
   Spec 18.2 also describes managed Postgres; nothing built here prevents it, and
   the least-privilege roles already assume a real separate migrator role.
3. **No public access.** Spec 20 decision D2 defaults to authenticated access
   only. `robots: { index: false }` is set now so the decision is not
   accidentally reversed by a default.
4. **Nepali names come later.** Neither boundary source ships Devanagari. See
   [Ward level: not feasible](#ward-level-not-feasible). `name_ne` is nullable
   throughout and search falls back to `name_en` until resolved.
5. **Tailwind 3, not 4.** Tailwind 3 is stable with Next 15.1 and supports
   `@apply` inside `@layer components`, which the print stylesheet needs.
6. **`is_demo` is enforced structurally.** `demo-badge` styling exists and
   `is_demo` is on every operational table, but no demo data exists yet. Phase 2
   creates it. A verification check already asserts no unflagged demo rows.

---

## Phase status

### Done (Phase 0)

**Database** — 4 migrations, applied and verified against live PostGIS:

- `0001_core_schema.sql` — four schemas (AD-3), five enums, `baseline`
  (admin_areas with the ward-consistency CHECK, roads, waterways, facilities,
  admin_aliases), `app` (organisations, users, sessions, four lookup tables per
  AD-8), `ops` (locations, population_records, interventions, distribution_items,
  routes, road_segments, road_status_history, hazard_areas, reports, attachments,
  imports, import_rows, import_mapping_templates), `audit.audit_log`,
  `schema_migrations`, and all grants.
- `0002_audit_trigger.sql` — generic `audit.log_change()` on 13 tables,
  `audit.set_actor()`, road-status-history side effect.
- `0003_views.sql` — 8 read models, including `access_rank()` and
  `counts_toward_totals()` defined before the views that call them.
- `0004_seed_lookups.sql` — 9 categories, 31 item types, 11 activity types, 15
  location types, Plan International plus 4 partner organisations. **No demo
  data.**

Three decisions inside these migrations are worth stating, because each fixes a
failure mode rather than adding a feature:

- **`UNKNOWN` road status ranks above `BLOCKED`.** `access_rank()` returns 6 for
  UNKNOWN and 5 for BLOCKED. An unverified road is operationally more dangerous
  than a known-blocked one, because a driver will attempt it. Rendered the other
  way, unverified roads display as the safest thing on the map. Asserted in
  `verify_migration.sql`, in the Zod mirror, and in unit tests.
- **Audit is written by trigger, and the trigger cannot be bypassed.** The
  application role owns nothing and cannot alter tables. `audit.audit_log` is
  `SELECT`-only for `app_rw`, including for Admins; `UPDATE`/`DELETE`/`TRUNCATE`
  are revoked from `PUBLIC`, `app_rw` and `tiles_ro`, and the revocation is
  re-asserted in the migration so a restored-from-dump database ends up
  append-only too.
- **Unit mixing is structurally impossible in the read model.**
  `v_distribution_totals` groups on `(area, category, item, unit, organisation)`.
  Quantity cannot be summed across units because the unit is part of the grouping
  key — not because a developer remembered the rule.

**Infrastructure** — compose with PostGIS 16-3.4, Martin, MinIO; `init.sql`
creating extensions, schemas and `NOINHERIT` least-privilege roles; Martin config
documented for V2.

**Contracts** — Zod schemas in `packages/schemas` as the single source per
entity (spec 19.6), including the shared filter object from spec 10.2. The filter
object canonicalises on parse: trimmed, upper-cased, de-duplicated **and
sorted**, because equivalent filters must produce one cache entry.

**Web** — Next.js 15 App Router shell, design tokens per spec 12.3 with a dark
theme, self-hosted fonts (including Devanagari), the declarative layer registry
from spec 11.2, the eight nav presets from spec 13.1, app header with the
first-class organisation lens, generated layer legends with dash patterns for all
six road statuses, and a print stylesheet.

**Verification** — 51 unit tests, 15 live-database structural checks, a token
contrast checker, ESLint with two domain-specific rules, and CI.

### Not done (and deliberately not faked)

- **No map.** The shell renders a placeholder that states boundary data is
  pending. Spec 19.3 forbids fabricating geography, and an empty map must never
  be ambiguous between "no flooding reported" and "no data loaded", so the
  placeholder says so explicitly.
- **No boundary data.** See below.
- **No API, no auth, no import engine.** Phases 2–5.
- **Search and user menu are visibly disabled**, not wired to fake results.

---

## Ward level: not feasible

**This is the single most consequential finding of Phase 0, and it resolves risk
R1 in the negative.**

There is **no ward-level polygon dataset for Nepal under a licence that permits
deploying it.** Full evidence, URLs and the licence analysis are in
[`docs/DATA_SOURCES.md`](DATA_SOURCES.md). Summary:

- OCHA's `cod-ab-npl` — the authoritative humanitarian source, which publishes
  ADM4 for the Philippines and Uganda — has **no ADM4 for Nepal**. It stops at
  municipality level. geoBoundaries returns HTTP 404 for Nepal ADM4.
- The **Survey Department**, the authoritative publisher, states "© 2026 Survey
  Department. All rights reserved" and does not publish ward polygons.
- The only national ward file (6,803 wards) has **no licence at all** — no
  `LICENSE`, no SPDX, no copyright holder. It also ships a mislabelled CRS
  (`Everest_1830` MUTM while the README claims EPSG:4326, a silent 50–200 m
  corruption trap) and 23 duplicate keys.
- OSM `admin_level=9` is licence-clean under ODbL but crowdsourced, and Nepal has
  **no published official ward code**, so a custom identifier would have to be
  invented.

**Decision taken:** Phase 1 proceeds at **province (7) → district (77) →
municipality (753)**. Ward features are marked unavailable, never fabricated
(spec 19.3).

**Decisions needed from the product owner:**

1. **Confirm municipality-level Phase 1 is acceptable**, given that the corridor
   districts' wards are the natural unit for a location profile. It is the
   right call under spec 19.3, but it is a scope reduction.
2. **Pursue written permission from OKN (`info@oknp.org`) or the Survey
   Department** for ward data. That is the only route to ward level that does not
   involve crowdsourced geometry.
3. **Or accept Bagmati-scoped OSM wards** (~1,121 wards, 13 districts) as
   crowdsourced-but-ODbL, with a custom documented ward identifier. Bagmati-only
   is the sensible first move: it covers the entire corridor, and an imperfect
   dataset scoped honestly beats an unlicensable one used silently.

Also unresolved: **Devanagari place names.** Neither boundary source ships them,
and `name_ne` plus Nepali-name search (spec 13.4) both depend on them. Currently
`name_ne` is nullable and search falls back to `name_en`.

---

## Deviations from the specification

| # | Deviation | Reason |
|---|---|---|
| D1 | Node `>=20.11` rather than pinned 20 LTS | Local Node 25; CI on 22. No incompatibility. |
| D2 | MinIO behind a compose `profile`, not always-on | Both MinIO registries were unreachable from the build environment (Docker Hub repo retired; quay.io returned 401). Phase 0 does not need object storage — `STORAGE_DRIVER=fs` is the default. `pnpm db:up:storage` starts it when the S3 adapter is built. |
| D3 | `admin_areas` has no `created_at` | It is reference geography, not a tracked record. Ward views report `last_updated = NULL` for wards with no activity, and consumers treat NULL as "never" rather than reading a fabricated timestamp. |
| D4 | No down-migrations | Spec 17 allows "reversible **or** documented rollback". `pnpm migrate:down` refuses explicitly and points at `docker compose down -v && pnpm migrate`. Immutable forward migrations are the safer convention. |
| D5 | Migration checksums compared in the runner | Not required, but editing an applied migration is the failure mode that silently makes environments diverge. The runner exits 1 and names the file. |
| D6 | Tailwind 3 rather than 4 | Tailwind 3 is stable with Next 15.1 and supports `@apply` in `@layer`, needed by the print stylesheet. |
| D7 | `drizzle.config.ts` present but unused | Spec 6 pairs Drizzle for non-spatial CRUD with raw SQL for spatial. Migrations are reviewed `.sql` files. The config exists for auxiliary helpers only and is not part of the migration path. |

---

## Next: Phase 1 acceptance criteria, and what will block it

From spec 17, Phase 1 requires: "all 7 provinces/77 districts/753 local units
(as present in the chosen source) load; wards render at zoom ≥ 9 for the corridor
districts."

**The ward half of that criterion cannot be met.** Revised criterion:

- 7 provinces, 77 districts and 753 local units load from COD-AB, filtered from
  its 775 to exclude protected areas — and the 22 excluded rows are **verified**
  to be protected areas, not assumed.
- Local-unit polygons render at zoom ≥ 9, sourced from LocalBoundaries and joined
  to COD-AB P-codes; the join is audited and unmatched rows are listed.
- Clicking a municipality shows number, name, district, province.
- Basemap loads with **no** calls to public OSM tile servers (CI enforces this).
- Spatial indexes confirmed with `EXPLAIN`.
- The UI states that ward-level features are unavailable.

Still needed before Phase 1: an `ogr2ogr`/`unzip` toolchain on the build machine
(GDAL is not installed locally), and a decision from the product owner on the
three ward questions above.