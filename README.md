# Nepal Flash-Flood Response GIS

Local-first, PostGIS-backed humanitarian web GIS for the Rasuwa–Nuwakot–Dhading–
Chitwan flash-flood response. Every affected location is an **operational
profile**: who is affected, what Plan International did, exactly what was
distributed, the access situation, supporting evidence, and the full update
history.

The map is the primary interface. The product is a geographic record of the
response, not a dashboard with a map attached.

**Status: Phase 0 complete.** Database schema, infrastructure, design system and
application shell. No map, no boundary data, no API yet — see
[`docs/PLAN.md`](docs/PLAN.md).

---

## Quick start

Requires Docker (for PostGIS) and Node 20+. **Use pnpm** — this is a workspace
monorepo.

```bash
pnpm install
Copy-Item .env.example .env      # bash: cp .env.example .env
pnpm db:up                       # PostGIS 16 + PostGIS 3.4, and Martin
pnpm migrate                     # 4 migrations
pnpm db:verify                   # 15 structural checks against live PostGIS
pnpm dev                         # http://localhost:3000
```

Then:

```bash
pnpm typecheck     # tsc across all packages
pnpm lint          # eslint, incl. local-first and SQL-injection guards
pnpm test          # 51 unit and acceptance tests (vitest)
pnpm test:tokens   # brand contrast, spec 12.2
pnpm e2e           # 15 Playwright specs, starts the dev server itself
pnpm build
```

`pnpm db:up:storage` additionally starts MinIO. Phase 0 uses the local
filesystem adapter (`STORAGE_DRIVER=fs`), so it is not needed.

---

## Repository layout

```
apps/web/            Next.js 15 App Router — UI plus route handlers
  app/               routes; (map) is the default
  components/
    map/             MapShell, LayerManager (Phase 1)
    filters/         LayerPanel, legends
    shell/           AppHeader, NavBar
  lib/
    env.ts           validated configuration, fails at boot
    map/layers.ts    declarative layer registry (spec 11.2)
  styles/
    tokens.css       design tokens, spec 12.3
    globals.css      print stylesheet, spec 13.8

packages/
  core/              domain logic — no Next.js, no React, no DB driver
  db/                SQL migrations, migration runner, pool, verification
  schemas/           Zod contracts — single source per entity (spec 19.6)

infra/
  docker-compose.yml PostGIS, Martin, optional MinIO
  postgres/init.sql  extensions, schemas, least-privilege roles
  martin/            tile server config (V2)

scripts/             check-token-contrast, future ingest-boundaries, build-tiles
tests/               acceptance tests (vitest) and e2e (playwright)
docs/                PLAN.md, DATA_DICTIONARY.md, DATA_SOURCES.md, ADR/
```

---

## Architecture in one page

```
 Browser ────────────── Next.js (React, TS) · MapLibre · TanStack Query
    │  JSON / GeoJSON          │  MVT (V2) / PMTiles
    ▼                          ▼
 Next.js route handlers ── Martin (PostGIS → MVT, V2)
 Zod validation · RBAC · import engine (V4) · audit context
    │  parameterised SQL
    ▼
 PostgreSQL 16 + PostGIS 3.4
 schemas: baseline (stable) │ ops (volatile) │ app │ audit (append-only)
```

Four decisions carry most of the weight. Each has an ADR.

| Decision | Why |
|---|---|
| **Audit by database trigger** ([ADR-0002](docs/ADR/0002-audit-by-trigger.md)) | Spec 8.4 requires audit that "cannot be bypassed by a code path that forgets to log". Application logging is the thing being rejected; only a trigger satisfies it. |
| **Invariants in the database** ([ADR-0005](docs/ADR/0005-invariant-enforcement-in-database.md)) | "Never add quantities with different units" holds for four consumers — map, API, table, dashboard. `unit` is in the SQL grouping key, so the forbidden sum is not expressible. |
| **`UNKNOWN` road status ranks worse than `BLOCKED`** ([ADR-0003](docs/ADR/0003-unknown-ranks-worst.md)) | A driver reads the map, not the data. An unverified road is more dangerous than a known washout, because someone will attempt it. |
| **No ward polygons in Phase 1** ([ADR-0004](docs/ADR/0004-no-ward-polygons.md)) | No ward dataset for Nepal exists under a deployable licence. Municipality level now; ward level would mean fabrication. |

Local-first is enforced, not just intended. ESLint fails the build on any
reference to `tile.openstreetmap.org`, CI greps the build output for it, an
e2e test asserts zero third-party requests, and `env.ts` refuses a public tile
URL in production.

---

## The twelve questions

Clicking any location answers these within one interaction: where it is, how many
are affected, the situation, what Plan International did, what was distributed,
how much, to how many, when, the road situation, who verified it, what reports
and evidence exist, and when it was last updated.

The corridor is **configuration**, not code — `DEFAULT_EXTENT_DISTRICTS` and
`packages/core/src/domain.ts`. Adding Gorkha is a config change.

---

## Data sources

Full provenance, licences and checksums: [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

| Layer | Source | Licence |
|---|---|---|
| Provinces, districts, municipalities | OCHA `cod-ab-npl` v02 | CC BY-IGO |
| Municipality geometry | LocalBoundaries (Open Knowledge Nepal) | CC BY 4.0 |
| Cartographic boundaries | OCHA `cod-em-npl` | CC BY-IGO |
| **Wards** | *none available* | — |

Ward level is not obtainable under a licence that permits deployment. Phase 1
proceeds at municipality level and the UI marks ward features unavailable rather
than inventing them (spec 19.3). **A product-owner decision is needed** — see
[ADR-0004](docs/ADR/0004-no-ward-polygons.md).

Devanagari place names are also unresolved; both sources ship English only.

---

## Brand

| Token | Hex | Meaning |
|---|---|---|
| `--brand-cyan` | `#58CAE7` | Default / initial state |
| `--brand-blue` | `#0072CE` | Hover / active / selected |
| `--brand-yellow` | `#FFD500` | Affected / alert / emphasis |

Cyan (1.9:1) and yellow (1.4:1) fail WCAG for text on white, so neither is
available as a text colour — `text-brand-cyan` and `text-brand-yellow` do not
exist in the Tailwind palette, and `scripts/check-token-contrast.mjs` fails the
build if one appears. Road status uses its own functional palette *plus* line
styles, because six states cannot be conveyed by three colours.

Demo data is labelled in the database (`is_demo`), in every API response, and in
the UI. No demo data exists yet.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Phase 0 plan, assumptions, deviations, what is not done |
| [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) | Every table, column, constraint and view |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) | Publishers, licences, checksums, extents, the ward-level finding |
| [`docs/ADR/`](docs/ADR/) | One file per architectural decision, with rejected alternatives |
| [`tests/acceptance.phase0.test.ts`](tests/acceptance.phase0.test.ts) | The Phase 0 rules, executable |
| [`packages/db/scripts/verify_migration.sql`](packages/db/scripts/verify_migration.sql) | 15 structural assertions, run against live PostGIS |

---

## Privacy

Aggregates only. There is intentionally **no table for named individuals**
(spec 8.5, 16.3). Free-text fields warn against names, phone numbers and personal
addresses. Imports of affected-population data are scanned for columns named like
`name`, `phone`, `citizenship` and require acknowledgement. A small-number
suppression threshold is configurable. Access is authenticated only — no public
read mode in V1.