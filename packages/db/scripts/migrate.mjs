#!/usr/bin/env node
/**
 * Migration runner.
 *
 * Deliberately small and dependency-free: migrations are plain .sql files in
 * this directory, applied in filename order, each in its own transaction, and
 * recorded in app.schema_migrations with a checksum (spec 19.9 - a merged
 * migration is never edited, because editing it would make the checksum of an
 * already-applied file disagree with the file on disk).
 *
 * Usage:
 *   node migrate.mjs up         apply all pending migrations
 *   node migrate.mjs status     show applied / pending
 *   node migrate.mjs down       roll back the most recent migration
 *
 * Connection precedence:
 *   MIGRATOR_DATABASE_URL  ->  DATABASE_MIGRATOR_URL  ->  DATABASE_URL
 */

import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const connString =
  process.env.MIGRATOR_DATABASE_URL ||
  process.env.DATABASE_MIGRATOR_URL ||
  process.env.DATABASE_URL

if (!connString) {
  console.error(
    'No database connection string. Set MIGRATOR_DATABASE_URL, DATABASE_MIGRATOR_URL or DATABASE_URL.\n' +
      'See .env.example. Migrations need the migrator role, not app_rw.',
  )
  process.exit(1)
}

// `pg` is a dependency of packages/db. Resolved relative to this file so the
// runner works regardless of cwd.
const { default: pg } = await import('pg')

const client = new pg.Client({ connectionString: connString })

function checksum(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function migrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR)
  return entries.filter((f) => f.endsWith('.sql')).sort()
}

async function ensureBookkeepingTable() {
  // Created defensively so `up` works even if 0001 has not run yet. 0001 also
  // creates it; IF NOT EXISTS keeps both paths valid.
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS app;
    CREATE TABLE IF NOT EXISTS app.schema_migrations (
      version     text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      checksum    text NOT NULL,
      duration_ms integer
    );
  `)
}

async function appliedMap() {
  const { rows } = await client.query(
    'SELECT version, checksum, applied_at, duration_ms FROM app.schema_migrations ORDER BY version',
  )
  return new Map(rows.map((r) => [r.version, r]))
}

async function up() {
  const files = await migrationFiles()
  const applied = await appliedMap()

  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const sum = checksum(sql)

    const prior = applied.get(version)
    if (prior) {
      if (prior.checksum !== sum) {
        // Not a warning. A changed checksum means someone edited a migration
        // that already ran somewhere, which is exactly the failure mode the
        // bookkeeping table exists to catch.
        console.error(
          `\nMIGRATION INTEGRITY ERROR: ${file} has changed since it was applied.\n` +
            `  applied: ${prior.checksum}\n  on disk: ${sum}\n` +
            'Applied migrations are immutable. Add a new migration instead.\n',
        )
        process.exitCode = 1
        return
      }
      console.log(`  skip    ${version} (applied ${prior.applied_at.toISOString()})`)
      continue
    }

    const started = Date.now()
    console.log(`  apply   ${version} ...`)
    try {
      await client.query(sql)
    } catch (err) {
      console.error(`\nFAILED: ${version}\n  ${err.message}\n`)
      process.exitCode = 1
      return
    }
    const duration = Date.now() - started

    await client.query(
      `INSERT INTO app.schema_migrations (version, checksum, duration_ms)
       VALUES ($1, $2, $3)`,
      [version, sum, duration],
    )
    console.log(`  ok      ${version} (${duration}ms)`)
  }

  if (!process.exitCode) console.log('\nAll migrations applied.')
}

async function down() {
  const files = await migrationFiles()
  const applied = await appliedMap()

  const last = [...applied.keys()].sort().pop()
  if (!last) {
    console.log('Nothing to roll back.')
    return
  }

  const file = files.find((f) => f.replace(/\.sql$/, '') === last)
  if (!file) {
    console.error(`Applied migration ${last} has no file on disk. Cannot roll back automatically.`)
    process.exitCode = 1
    return
  }

  // Migrations here do not carry down-migrations. Rolling forward with a new
  // migration is the supported path; this is an explicit, loud escape hatch
  // for development only (spec 17 "definition of done": reversible or
  // documented rollback).
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'baseline' AND table_name = 'admin_areas'`,
  )
  if (rows.length > 0) {
    console.error(
      `\nRefusing to roll back ${last} automatically.\n` +
        'Migrations in this project do not ship down-migrations. Drop the database\n' +
        '(docker compose -f infra/docker-compose.yml down -v) and re-run `pnpm db:up && pnpm migrate`.\n',
    )
    process.exitCode = 1
    return
  }

  await client.query('DELETE FROM app.schema_migrations WHERE version = $1', [last])
  console.log(`Rolled back bookkeeping for ${last}.`)
}

async function status() {
  const files = await migrationFiles()
  const applied = await appliedMap()

  console.log('')
  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    const row = applied.get(version)
    console.log(
      row
        ? `  applied  ${version.padEnd(28)} ${row.applied_at.toISOString()}  ${row.duration_ms}ms`
        : `  pending  ${version}`,
    )
  }
  console.log('')
}

const command = process.argv[2] ?? 'up'

await client.connect()
try {
  await ensureBookkeepingTable()
  if (command === 'up') await up()
  else if (command === 'down') await down()
  else if (command === 'status') await status()
  else {
    console.error(`Unknown command: ${command}. Use up | down | status.`)
    process.exitCode = 1
  }
} catch (err) {
  console.error(err.message)
  process.exitCode = 1
} finally {
  await client.end()
}