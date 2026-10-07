import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the repository-root .env into process.env.
 *
 * Next.js only reads .env files from its own directory (apps/web), but the
 * repo convention is a single .env at the root next to .env.example and the
 * compose file - one file to create, and one place to look when a variable is
 * missing. Re-loading it here means the same file configures `next dev`,
 * `next build`, `next start` and the db scripts.
 *
 * Written by hand rather than pulling in dotenv: it is a dozen lines, has no
 * dependency, and deliberately does nothing fancy. Existing process.env values
 * always win, so CI and shell overrides are never clobbered by the file.
 */
function loadRootEnv() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const envPath = resolve(repoRoot, '.env')
  if (!existsSync(envPath)) return

  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip matching surrounding quotes, which .env.example uses for values
    // that would otherwise be ambiguous.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadRootEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Separate output directories for dev and build.
  //
  // `output: 'standalone'` makes `next build` copy node_modules into
  // .next/standalone. `next dev` then walks the same .next directory and hits
  // those copies, failing with `EPERM: scandir .next/standalone/.../react`.
  // The two builds are also never both wanted at once, so they do not need to
  // share a directory. This is a real papercut: build, then dev, and dev is
  // broken until you delete .next by hand.
  distDir: process.env.NODE_ENV === 'production' ? '.next' : '.next-dev',

  output: 'standalone',
  experimental: {
    // Server Components by default. The map, panels and import wizard are all
    // client components; everything else should stay on the server.
    optimizePackageImports: ['maplibre-gl'],
  },
  // Production guard from spec 3 (local-first) and spec 9.3.
  // A public OSM tile server must never be reachable in production, because
  // it leaks response data to a third party and breaks in the field.
  async headers() {
    const isProd = process.env.NODE_ENV === 'production'
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
        ],
      },
    ]
  },
  }

export default nextConfig