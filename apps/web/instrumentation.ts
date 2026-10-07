/**
 * Runs on server boot, not during `next build`.
 *
 * Next.js executes instrumentation.ts once when a request-serving process
 * starts. That makes it the right place for the production configuration checks
 * that must not run during a build: requiring AUTH_SECRET here means `next
 * build` works in CI without a secret, while `next start` refuses to serve
 * without one.
 *
 * The checks read process.env directly rather than importing @/lib/env, because
 * that module is evaluated at import time - by the time this runs, the guards
 * inside it have already been passed. Re-importing it would return the same
 * already-validated value and check nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.AUTH_SECRET) {
      throw new Error(
        'AUTH_SECRET is required in production (spec 16.2). Generate one with: openssl rand -base64 32',
      )
    }

    if (process.env.ENABLE_DEV_BASEMAP_FALLBACK === 'true') {
      throw new Error(
        'ENABLE_DEV_BASEMAP_FALLBACK must be false in production (spec 9.3). ' +
          'The public OSM tile server is not permitted as a basemap for this deployment.',
      )
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. PostGIS is the system of record (AD-2). See .env.example.')
  }
}