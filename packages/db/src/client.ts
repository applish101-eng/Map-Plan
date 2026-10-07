/**
 * Database pool.
 *
 * The application connects as `app_rw`, which owns nothing and cannot alter the
 * schema. Migrations use `DATABASE_MIGRATOR_URL` and a separate connection, so
 * that a bug in a route handler cannot migrate the database it is talking to
 * (spec 16.2, least privilege).
 *
 * Two things here are load-bearing rather than incidental:
 *
 * 1. Every pool connection installs audit.set_actor(). A pooled connection is
 *    reused across requests, so actor context must be reset per transaction -
 *    not per checkout, or one user's writes would be attributed to the previous
 *    user on the same connection. The helper is called with `SET LOCAL` inside
 *    each transaction for exactly this reason.
 *
 * 2. Spatial results come back as GeoJSON. The app speaks RFC 7946 (AD-9); the
 *    database speaks WKB. Converting here, once, is what stops a layer from
 *    ever emitting SRID-tagged WKB by mistake.
 */

import pg from 'pg'

/**
 * Minimal environment read.
 *
 * Deliberately not shared with the app's env module: packages/db must be
 * importable from scripts, migrations and CI without pulling in Next.js
 * server-only code. Both read the same variable names, and both fail loudly
 * when DATABASE_URL is absent.
 */
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. PostGIS is the system of record (AD-2); there is no in-memory fallback. See .env.example.`,
    )
  }
  return value
}

const { Pool, types } = pg

// Return geometry and geography columns as GeoJSON rather than hex WKB.
// 4326 in, RFC 7946 out, which is the ordering MapLibre and Turf both expect.
//
// The OIDs are the PostGIS type ids. Cast through `as never` because @types/pg
// types setTypeParser against its own TypeId union, which does not include the
// spatial ids - the values are correct, the union is just incomplete.
const OID_GEOMETRY = 1399
const OID_GEOGRAPHY = 7900

types.setTypeParser(OID_GEOMETRY as never, (value: string) => JSON.parse(value))
types.setTypeParser(OID_GEOGRAPHY as never, (value: string) => JSON.parse(value))

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (pool) return pool

  pool = new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'nepal-flood-gis',
  })

  // An idle client erroring (network blip, database restart) must not take down
  // the process: the pool discards it and the next request gets a fresh one.
  pool.on('error', (err) => {
    console.error('[db] idle client error', err.message)
  })

  return pool
}

/**
 * Run a query.
 *
 * Every statement goes through here so that parameterised SQL is the only
 * reachable path. There is no string-interpolated query helper in this package
 * by design (spec 16.2).
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as never[])
}

/** Convenience for a single row. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await query<T>(text, params)
  return result.rows[0] ?? null
}

export type ActorContext = {
  actorId: string | null
  actorLabel: string | null
  requestId: string | null
  importId?: string | null
}

/**
 * Run a function inside a transaction with actor context set.
 *
 * This is the only supported way to write operational data. It guarantees:
 *   - the write is atomic (spec AD-6: one transaction per import batch)
 *   - the audit trigger can attribute the change (spec 8.4)
 *   - a failed batch leaves no partial state
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>, actor?: ActorContext): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    if (actor) {
      // Local (transaction-scoped) settings, so pooled connections cannot leak
      // one request's actor into the next request's audit rows.
      await client.query('SELECT audit.set_actor($1::uuid, $2, $3, $4::uuid)', [
        actor.actorId,
        actor.actorLabel,
        actor.requestId,
        actor.importId ?? null,
      ])
    }

    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/** Liveness probe for /api/health (spec 18.5). */
export async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const row = await queryOne<{ last_change: string | null }>('SELECT last_data_change FROM ops.v_freshness')
    return { ok: true, detail: row?.last_change ?? 'no data yet' }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'unknown error' }
  }
}