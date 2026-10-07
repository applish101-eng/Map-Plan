/**
 * Environment configuration (spec 18.3).
 *
 * Validated once at module load so a missing or malformed variable fails at
 * boot with a clear message rather than surfacing as a confusing runtime error
 * deep inside a map layer. Server-only: never import from a client component.
 */

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url().optional(),
  DATABASE_MIGRATOR_URL: z.string().url().optional(),
  DATABASE_TILES_URL: z.string().url().optional(),

  MAP_STYLE_URL: z.string().default('/styles/basemap-style.json'),
  PMTILES_URL: z.string().optional(),

  /**
   * Development escape hatch to a permitted public raster basemap. Spec 9.3
   * allows it for first-run development ONLY and requires it off in production,
   * because using it leaks tile requests to a third party and breaks offline.
   */
  ENABLE_DEV_BASEMAP_FALLBACK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_FS_ROOT: z.string().default('./data/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  /** Corridor configuration (spec 1.4: extent is configuration, not code). */
  DEFAULT_EXTENT_DISTRICTS: z.string().default('Rasuwa,Nuwakot,Dhading,Chitwan'),
  /**
   * UUID of the primary organisation, resolved from app.organisations after the
   * seed. Optional and intentionally not coerced: .env.example ships it empty,
   * and a bare empty string must read as "not configured yet" rather than as a
   * validation failure that blocks the app from booting.
   */
  PRIMARY_ORG_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined))
    .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
      message: 'must be a UUID (leave empty to resolve is_primary from the database instead)',
    }),

  /** Counts below this threshold display as "<5". 0 disables suppression. */
  SMALL_NUMBER_THRESHOLD: z.coerce.number().int().min(0).default(0),

  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_TRUST_HOST: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  IMPORT_PREVIEW_ROWS: z.coerce.number().int().positive().default(200),
})

function load() {
  const raw = process.env
  const parsed = envSchema.safeParse(raw)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`)
  }

  const env = parsed.data

  // Spec 9.3: the production guard. Failing at boot is deliberate - a
  // misconfigured deploy that quietly reached tile.openstreetmap.org would
  // break the local-first guarantee with no visible symptom until the field.
  if (env.NODE_ENV === 'production' && env.ENABLE_DEV_BASEMAP_FALLBACK) {
    throw new Error(
      'ENABLE_DEV_BASEMAP_FALLBACK must be false in production (spec 9.3). ' +
        'The public OSM tile server is not permitted as a basemap for this deployment.',
    )
  }

  // Spec 9.3, structural form: refuse to configure a public OSM tile URL at all
  // in production, whichever variable it arrives in. envSchema above only knows
  // about the fallback flag, so a future PMTILES_URL pointed at
  // tile.openstreetmap.org would otherwise sail past it.
  if (env.NODE_ENV === 'production') {
    for (const [key, value] of [
      ['PMTILES_URL', env.PMTILES_URL],
      ['MAP_STYLE_URL', env.MAP_STYLE_URL],
    ] as const) {
      if (value && /(^|\/\/|\.)(tile\.)?openstreetmap\.org/i.test(value)) {
        throw new Error(
          `${key} points at a public OSM tile server. Serve basemap tiles from local PMTiles (spec 9.3).`,
        )
      }
    }
  }

  // A secret is not required at build time. `next build` sets NODE_ENV=production
  // but starts no server, so demanding one would break CI and local builds for
  // no reason - and the usual workaround is a fake secret committed to CI. The
  // production requirement is enforced in instrumentation.ts, which Next.js runs
  // only for `next start`.
  if (env.NODE_ENV === 'production' && env.ENABLE_DEV_BASEMAP_FALLBACK) {
    throw new Error(
      'ENABLE_DEV_BASEMAP_FALLBACK must be false in production (spec 9.3). ' +
        'The public OSM tile server is not permitted as a basemap for this deployment.',
    )
  }

  return env
}

export const env = load()

export type Env = typeof env

/** Corridor districts from configuration, trimmed and de-duplicated. */
export const extentDistricts = (() => {
  const seen = new Set<string>()
  return env.DEFAULT_EXTENT_DISTRICTS.split(',')
    .map((d) => d.trim())
    .filter((d) => {
      if (d.length === 0 || seen.has(d)) return false
      seen.add(d)
      return true
    })
})()