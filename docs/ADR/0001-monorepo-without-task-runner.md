# ADR-0001: Monorepo without a task-runner framework

**Status:** accepted · **Date:** 7 October 2026 · **Phase:** 0

## Context

The spec (section 7) specifies a pnpm workspace monorepo with five packages. It
does not specify a task runner.

The brief asked whether the product could be built as plain HTML, CSS and
JavaScript. Most of it could: the map, the location profile panel, all eight tabs,
filters, search, the design system and the import wizard are presentation. But
four requirements in the spec are only satisfiable server-side or in the
database:

- **Audit that cannot be bypassed** (8.4, AD-7). The spec rejects
  application-level logging precisely because a code path can forget to call it. A
  database trigger is the only implementation that actually guarantees this.
- **"Never rely on UI hiding"** (16.1). Client-side role checks are not
  authorisation; a user with devtools can call any endpoint.
- **`ST_Within` / `ST_DWithin` and ward aggregation** across ~7,500 wards
  (8.6, 8.7). Needs spatial indexes; doing it client-side is a performance cliff.
- **Unit-mixing prohibited in aggregation** (8.5), which must hold for the API,
  the table, the dashboard and the tile server. A view-level guarantee cannot.

So the specified stack stands: Next.js for UI plus route handlers, PostGIS as the
system of record.

The remaining question is how much workspace machinery to add on top.

## Decision

Plain pnpm workspaces. **No Turborepo, no Nx, no custom task graph.**

Scripts in the root `package.json` compose across workspaces directly:

```json
"typecheck": "pnpm -r typecheck",
"test":      "vitest run",
"migrate":   "node packages/db/scripts/migrate.mjs up"
```

## Rationale

- **The spec's own scale does not need a graph.** Five packages, one app. The
  dependency edges are shallow: `web → core → schemas`, and `db` is used by
  scripts. A build graph engine solves dependency-ordering problems that this
  repository does not have.
- **A task runner adds a second configuration language** whose failure modes are
  silent cache invalidation and stale remote-cache entries. That is a poor trade
  for a project where correctness of a spatial query matters more than build
  latency.
- **Debuggability.** `pnpm --filter <pkg> <script>` works with no extra tool, and
  a failed step shows the real command.
- **It is reversible.** Migrating to Turborepo later is a one-file change. The
  packages do not depend on the runner.

## Consequences

- No cross-package build caching. `pnpm build` recompiles `web` each time. At this
  size that is seconds, and `web` is the only package that builds.
- No incremental task orchestration. `pnpm -r typecheck` runs sequentially. Four
  packages, a few seconds.
- CI expresses its pipelines as explicit jobs (`static`, `test`, `database`,
  `build`) rather than a task graph. This is arguably better: the database job
  needs a real PostGIS service, which a task runner would not provide anyway.

## Alternatives considered

**A single Next.js app with no `packages/`** — fewer moving parts, but it puts
domain logic inside the framework, which AD-1 explicitly designs against so the
core can be lifted into a standalone API later without rewriting business rules.

**Turborepo** — the usual default. Rejected on the grounds above. Worth revisiting
if package count passes roughly ten or if remote caching becomes a bottleneck.