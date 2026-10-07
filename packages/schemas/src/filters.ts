import { z } from 'zod'
import {
  accessStatuses,
  categoryCodes,
  confidenceLevels,
  verificationStatuses,
} from './enums'

/**
 * The shared filter object (spec 10.2).
 *
 * One filter shape drives the map layers, the details panel, the data table and
 * the dashboard. That is the point: a separate filter contract per surface is
 * how a dashboard ends up disagreeing with the map it sits next to.
 *
 * On the wire these are comma-separated arrays or single values, parsed by
 * filterSchema below. The parsed result is what lands in every TanStack Query
 * key, so two different filter states can never share a cache entry.
 */

/**
 * Accepts either wire form: a comma-separated string ("Rasuwa,Nuwakot") or an
 * already-parsed array (['Rasuwa','Nuwakot']).
 *
 * Accepting both is a correctness requirement, not leniency. The filter object
 * lives in the URL, in the Zustand store and in every TanStack Query key, so it
 * gets parsed from a query string and then re-validated as it moves between
 * those. A schema that only accepts strings would reject its own output the
 * moment anything re-parsed a parsed filter - and since every failure mode of
 * that is a filter silently matching nothing, it is worth making impossible.
 *
 * Values are upper-cased and de-duplicated so ['rasuwa','RASUWA'] and
 * 'Rasuwa,rasuwa' are the same filter and therefore the same cache key.
 */
/**
 * Normalise a wire value into a trimmed, de-duplicated, upper-cased string list.
 *
 * Upper-casing is what makes the filter case-insensitive in practice: users
 * type "rasuwa", URL builders emit "Rasuwa", and both must produce the same
 * cache key or the same logical filter gets fetched twice.
 *
 * A bare `*` or `-` means "no constraint on this dimension" (a wildcard chip in
 * the filter panel), which normalises to an empty list.
 */
const toArray = (input: unknown): unknown[] => {
  if (input === undefined || input === null || input === '') return []
  if (Array.isArray(input)) {
    return input
      .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
      .filter((v) => v !== '' && v !== '*' && v !== '-')
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter((v) => v.length > 0 && v !== '*' && v !== '-')
  }
  // Anything else (a number, an object) is passed through so Zod reports it
  // rather than it being silently coerced.
  return input as unknown[]
}

/**
 * Trim, upper-case, de-duplicate AND sort.
 *
 * Sorting is what makes the filter set a canonical form: without it,
 * `district=Rasuwa,Nuwakot` and `district=Nuwakot,Rasuwa` are the same filter
 * but produce different query strings, so they land in different TanStack Query
 * cache entries and the same data gets fetched and stored twice. Canonicalising
 * at parse time means equality comparisons and cache keys both just work.
 */
const normalise = (arr: string[]) =>
  [...new Set(arr.map((v) => v.trim().toUpperCase()))].sort((a, b) => a.localeCompare(b))

/**
 * Open-ended list: any non-empty token. Used for values that are data-driven
 * (district, municipality, ward, organisation, activity type, location type)
 * and therefore cannot be an enum - the lookup tables are extensible (AD-8).
 */
const csvStrings = z.preprocess(toArray, z.array(z.string()).default([])).transform(normalise)

/**
 * Closed list: values constrained to a known enum (categories, access statuses,
 * verification statuses, confidence).
 *
 * Unknown values are dropped rather than failing the whole query: a filter chip
 * left over from a retired category should narrow to nothing, not reject the
 * entire request. The dropped values are visible to the caller via the
 * `unknownFilterValues` helper below, so the UI can surface "this filter value
 * is not recognised" instead of silently showing an empty map.
 */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .preprocess(toArray, z.array(z.enum(values).or(z.string())).default([]))
    .transform((arr) => normalise(arr.filter((v): v is T[number] => values.includes(v as T[number]))))

/** bbox arrives as "minLon,minLat,maxLon,maxLat" (spec 10.2). */
const bboxSchema = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s || !s.trim()) return undefined
    const parts = s.split(',').map((v) => Number(v.trim()))
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox must be "minLon,minLat,maxLon,maxLat"' })
      return z.NEVER
    }
    const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number]
    if (minLon > maxLon || minLat > maxLat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox minimums must not exceed maximums' })
      return z.NEVER
    }
    return { minLon, minLat, maxLon, maxLat } as const
  })

export const filterSchema = z.object({
  district: csvStrings,
  municipality: csvStrings,
  ward: csvStrings,
  organisation: csvStrings,
  category: csvEnum(categoryCodes),
  activityType: csvStrings,
  access: csvEnum(accessStatuses),
  verification: csvEnum(verificationStatuses),
  confidence: csvEnum(confidenceLevels),
  locationType: csvStrings,
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  affectedMin: z.coerce.number().int().min(0).optional(),
  affectedMax: z.coerce.number().int().min(0).optional(),
  /**
   * Off by default: official totals count VALID records only (spec 8.5). When a
   * user turns this on, the UI must show that the mode is active - otherwise
   * provisional numbers read as confirmed ones.
   */
  includeUnverified: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  bbox: bboxSchema,
  q: z.string().trim().optional(),
})

export type Filters = z.infer<typeof filterSchema>
export type FilterInput = z.input<typeof filterSchema>

/** True when nothing is filtered, so the map can show "unfiltered" in the UI. */
export const isEmptyFilter = (f: Filters) =>
  f.district.length === 0 &&
  f.municipality.length === 0 &&
  f.ward.length === 0 &&
  f.organisation.length === 0 &&
  f.category.length === 0 &&
  f.activityType.length === 0 &&
  f.access.length === 0 &&
  f.verification.length === 0 &&
  f.confidence.length === 0 &&
  f.locationType.length === 0 &&
  f.dateFrom === undefined &&
  f.dateTo === undefined &&
  f.affectedMin === undefined &&
  f.affectedMax === undefined &&
  !f.includeUnverified &&
  f.bbox === undefined &&
  !f.q

/**
 * Serialise back to a query string.
 *
 * Accepts either the raw input shape (comma-separated strings, as parsed from
 * the URL) or an already-parsed Filters object (arrays, booleans). Accepting
 * both is not convenience for its own sake: a parsed Filters object must be
 * able to round-trip back to a URL, and serialising an array as `district[]=`
 * or `district=Rasuwa,Nuwakot` from two different shapes is exactly the kind of
 * drift that produces a query that looks right and matches nothing.
 *
 * Key order is fixed, so two equivalent filter objects always produce
 * byte-identical strings - otherwise identical filters produce separate cache
 * entries.
 */
export function serialiseFilters(f: FilterInput | Filters): string {
  const params = new URLSearchParams()
  for (const key of [
    'district',
    'municipality',
    'ward',
    'organisation',
    'category',
    'activityType',
    'access',
    'verification',
    'confidence',
    'locationType',
  ] as const) {
    const value = f[key]
    if (value === undefined || value === null) continue
    // Join either an array (parsed form) or accept a single string (URL form).
    const joined = Array.isArray(value) ? value.join(',') : String(value)
    if (joined.length > 0) params.set(key, joined)
  }
  for (const key of ['dateFrom', 'dateTo', 'q'] as const) {
    const v = f[key]
    if (typeof v === 'string' && v.length > 0) params.set(key, v)
  }
  for (const key of ['affectedMin', 'affectedMax'] as const) {
    const v = f[key]
    if (typeof v === 'number' && Number.isFinite(v)) params.set(key, String(v))
  }
  // Accept the boolean (parsed) and the string (URL) form.
  if (f.includeUnverified === true || f.includeUnverified === 'true') {
    params.set('includeUnverified', 'true')
  }
  if (f.bbox) {
    const b = f.bbox as { minLon: number; minLat: number; maxLon: number; maxLat: number }
    params.set('bbox', [b.minLon, b.minLat, b.maxLon, b.maxLat].join(','))
  }
  const s = params.toString()
  return s.length > 0 ? `?${s}` : ''
}

/**
 * Filters live in the URL so a link is shareable (spec 13.3). Stable key
 * ordering here is what makes that useful rather than annoying.
 */
export const filterQueryKeys = [
  'district',
  'municipality',
  'ward',
  'organisation',
  'category',
  'activityType',
  'access',
  'verification',
  'confidence',
  'locationType',
  'dateFrom',
  'dateTo',
  'affectedMin',
  'affectedMax',
  'includeUnverified',
  'bbox',
  'q',
] as const