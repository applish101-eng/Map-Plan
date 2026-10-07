import { describe, it, expect } from 'vitest'
import {
  accessRank,
  accessLineStyle,
  accessStatuses,
  verificationStatuses,
  confidenceLevels,
  deliveryStatuses,
  userRoles,
  categoryCodes,
  accessStatusLabels,
} from '@nepal-flood-gis/schemas'
import { filterSchema, serialiseFilters, isEmptyFilter } from '@nepal-flood-gis/schemas'
import { pointWithinNepal, nepalBbox, populationCoherence } from '@nepal-flood-gis/schemas'
import { corridorConfig, provinceByDistrict, PRIMARY_ORG_NAME } from '@nepal-flood-gis/core'
import { layerRegistry, navPresets } from '@/lib/map/layers'

/**
 * Phase 0 acceptance tests.
 *
 * These cover the rules that are cheap to get wrong and expensive to notice
 * later: the access-status ordering, the unit-mixing prohibition's inputs, the
 * filter contract, and the configuration-not-code requirement for the corridor.
 */

describe('access status ordering (spec 12.3, risk: unknown road reads as open)', () => {
  it('ranks UNKNOWN as more restrictive than BLOCKED', () => {
    // The single most dangerous possible regression in the schema: an
    // unverified road rendering as the safest thing on the map.
    expect(accessRank.UNKNOWN).toBeGreaterThan(accessRank.BLOCKED)
  })

  it('orders OPEN as least restrictive', () => {
    expect(accessRank.OPEN).toBeLessThan(accessRank.RESTRICTED)
    expect(accessRank.OPEN).toBeLessThan(accessRank['4WD_ONLY'])
  })

  it('is strictly increasing across all six states', () => {
    const ordered = [...accessStatuses].sort((a, b) => accessRank[a] - accessRank[b])
    expect(ordered).toEqual(['OPEN', 'RESTRICTED', '4WD_ONLY', 'DAMAGED', 'BLOCKED', 'UNKNOWN'])
  })

  it('gives every status a distinct rank', () => {
    const ranks = accessStatuses.map((s) => accessRank[s])
    expect(new Set(ranks).size).toBe(accessStatuses.length)
  })
})

describe('access status is carried by line style as well as colour (spec 12.3)', () => {
  it('assigns every status a line style', () => {
    for (const status of accessStatuses) {
      expect(accessLineStyle[status]).toBeDefined()
    }
  })

  it('does not rely on colour alone: at least four distinct dash patterns', () => {
    // A colour-only legend would fail in greyscale print and for colour-vision
    // deficiency. Six statuses need real shape differences.
    const patterns = new Set(accessStatuses.map((s) => accessLineStyle[s].dash.join(',')))
    expect(patterns.size).toBeGreaterThanOrEqual(4)
  })

  it('labels all six states in human-readable form', () => {
    for (const status of accessStatuses) {
      expect(accessStatusLabels[status]).toBeTruthy()
    }
  })
})

describe('enum contracts match the SQL migrations', () => {
  it('verification statuses match ops.verification_status', () => {
    expect([...verificationStatuses]).toEqual(['NEW', 'REVIEW', 'VALID', 'NOT_VALID', 'EXPIRED'])
  })

  it('confidence levels match ops.confidence_level', () => {
    expect([...confidenceLevels]).toEqual(['LOW', 'MEDIUM', 'HIGH'])
  })

  it('delivery statuses match ops.delivery_status', () => {
    expect([...deliveryStatuses]).toEqual(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  })

  it('user roles match app.user_role', () => {
    expect([...userRoles]).toEqual(['ADMIN', 'EDITOR', 'VIEWER'])
  })

  it('category codes match the app.categories seed', () => {
    expect(categoryCodes).toContain('FOOD')
    expect(categoryCodes).toContain('CASH_VOUCHER')
    expect(categoryCodes).toHaveLength(9)
  })
})

describe('shared filter object (spec 10.2)', () => {
  it('defaults every collection filter to empty', () => {
    const f = filterSchema.parse({})
    expect(f.district).toEqual([])
    expect(f.category).toEqual([])
    expect(f.access).toEqual([])
    expect(isEmptyFilter(f)).toBe(true)
  })

  it('defaults includeUnverified to false, so official totals are VALID-only', () => {
    expect(filterSchema.parse({}).includeUnverified).toBe(false)
  })

  it('parses comma-separated arrays, upper-cases and canonicalises them', () => {
    // Sorted output, not input order: the filter object is a canonical form so
    // that equivalent filters share a cache key (see serialiseFilters).
    const f = filterSchema.parse({ district: 'rasuwa,nuwakot', access: 'blocked,restricted' })
    expect(f.district).toEqual(['NUWAKOT', 'RASUWA'])
    expect(f.access).toEqual(['BLOCKED', 'RESTRICTED'])
  })

  it('de-duplicates repeated values', () => {
    const f = filterSchema.parse({ district: 'Rasuwa,rasuwa,RASUWA' })
    expect(f.district).toEqual(['RASUWA'])
  })

  it('drops an unknown category without rejecting the whole query', () => {
    // A filter chip for a retired category must narrow to nothing rather than
    // fail the request: one bad chip should not blank the map for everything
    // else the user selected.
    const parsed = filterSchema.safeParse({ category: 'NOT_A_CATEGORY' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.category).toEqual([])
  })

  it('keeps recognised values when one value in a list is unknown', () => {
    const parsed = filterSchema.safeParse({ category: 'FOOD,NOT_A_CATEGORY' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.category).toEqual(['FOOD'])
  })

  it('treats a wildcard as no constraint', () => {
    const parsed = filterSchema.safeParse({ district: '*' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.district).toEqual([])
      expect(isEmptyFilter(parsed.data)).toBe(true)
    }
  })

  it('parses a bbox of four numbers', () => {
    const f = filterSchema.parse({ bbox: '85.0,27.5,86.0,28.5' })
    expect(f.bbox).toEqual({ minLon: 85, minLat: 27.5, maxLon: 86, maxLat: 28.5 })
  })

  it('rejects a malformed bbox instead of guessing', () => {
    expect(filterSchema.safeParse({ bbox: '85.0,27.5' }).success).toBe(false)
    expect(filterSchema.safeParse({ bbox: '86.0,27.5,85.0,28.5' }).success).toBe(false)
  })

  it('is not empty when any filter is set', () => {
    expect(isEmptyFilter(filterSchema.parse({ district: 'Rasuwa' }))).toBe(false)
    expect(isEmptyFilter(filterSchema.parse({ includeUnverified: 'true' }))).toBe(false)
  })

  it('serialises to a stable, order-independent query string', () => {
    // Stable serialisation matters because the filter object goes into every
    // query key: two equivalent filters must not produce two cache entries.
    const a = filterSchema.parse({ district: 'Rasuwa,Nuwakot', access: 'BLOCKED' })
    const b = filterSchema.parse({ access: 'BLOCKED', district: 'nuwakot,rasuwa' })
    expect(serialiseFilters(a)).toBe(serialiseFilters(b))
  })

  it('omits empty filters from the query string', () => {
    const f = filterSchema.parse({ district: 'Rasuwa', category: [] })
    expect(serialiseFilters(f)).toBe('?district=RASUWA')
  })

  it('round-trips through the query string', () => {
    const original = filterSchema.parse({
      district: 'Rasuwa',
      category: 'FOOD',
      includeUnverified: 'true',
      dateFrom: '2026-09-01',
    })
    const query = serialiseFilters(original)
    const params = new URLSearchParams(query.slice(1))
    const roundTripped = filterSchema.parse(Object.fromEntries(params.entries()))
    expect(roundTripped).toEqual(original)
  })
})

describe('Nepal coordinate sanity checks (spec 14.3)', () => {
  it('accepts a known corridor point (Kathmandu)', () => {
    expect(pointWithinNepal(85.324, 27.717)).toBe(true)
  })

  it('accepts Rasuwa corridor points', () => {
    expect(pointWithinNepal(85.298, 28.108)).toBe(true)
  })

  it('rejects points outside Nepal', () => {
    expect(pointWithinNepal(0, 0)).toBe(false)
    expect(pointWithinNepal(100, 40)).toBe(false)
  })

  it('rejects swapped lat/lon, which look plausible in Nepal', () => {
    // 27.717 as longitude, 85.324 as latitude. Both individually in range for
    // some bboxes, so an explicit bbox test is needed rather than range checks.
    expect(pointWithinNepal(27.717, 85.324)).toBe(false)
  })

  it('has a bbox that covers the whole country', () => {
    expect(nepalBbox.minLon).toBeLessThan(80.1)
    expect(nepalBbox.maxLon).toBeGreaterThan(88)
    expect(nepalBbox.minLat).toBeLessThan(26.4)
    expect(nepalBbox.maxLat).toBeGreaterThan(30.4)
  })
})

describe('population coherence (spec 14.3 WARNING, and a CHECK constraint)', () => {
  it('rejects households exceeding people', () => {
    expect(populationCoherence({ affectedPeople: 100, affectedHouseholds: 103 })).toBe(false)
  })

  it('accepts households less than or equal to people', () => {
    expect(populationCoherence({ affectedPeople: 100, affectedHouseholds: 40 })).toBe(true)
    expect(populationCoherence({ affectedPeople: 100, affectedHouseholds: 100 })).toBe(true)
  })

  it('accepts a record with only one of the two counts', () => {
    expect(populationCoherence({ affectedPeople: 100 })).toBe(true)
    expect(populationCoherence({ affectedHouseholds: 40 })).toBe(true)
  })
})

describe('corridor is configuration, not code (spec 1.4)', () => {
  it('keeps the four corridor districts in order', () => {
    expect(corridorConfig.corridor).toEqual(['Rasuwa', 'Nuwakot', 'Dhading', 'Chitwan'])
  })

  it('uses Kathmandu as the logistics origin', () => {
    expect(corridorConfig.logisticsOrigin).toBe('Kathmandu')
  })

  it('records Gorkha as planned expansion, not in scope', () => {
    expect(corridorConfig.plannedExpansion).toContain('Gorkha')
    expect(corridorConfig.corridor).not.toContain('Gorkha')
  })

  it('places all four corridor districts in Bagmati and Gorkha in Gandaki', () => {
    // Spec 1.4 states this explicitly; a wrong province label is a credibility
    // problem for the whole product, so it is asserted rather than assumed.
    for (const district of corridorConfig.corridor) {
      expect(provinceByDistrict[district]).toBe('Bagmati')
    }
    expect(provinceByDistrict.Gorkha).toBe('Gandaki')
  })

  it('has an initial view inside the country bbox', () => {
    const [lon, lat] = corridorConfig.initialView.center
    expect(pointWithinNepal(lon, lat)).toBe(true)
  })

  it('names the primary organisation rather than hard-coding Plan in a UI string', () => {
    expect(PRIMARY_ORG_NAME).toBe('Plan International Nepal')
  })
})

describe('layer registry (spec 11.2, 11.3)', () => {
  it('declares unique layer ids', () => {
    const ids = layerRegistry.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every layer a legend, so no legend is hand-written', () => {
    for (const layer of layerRegistry) {
      expect(layer.legend.title).toBeTruthy()
    }
  })

  it('includes the V1 layers from spec 11.3', () => {
    const ids = layerRegistry.map((l) => l.id)
    for (const required of [
      'basemap',
      'admin-district',
      'admin-ward',
      'affected-population',
      'plan-response',
      'roads',
      'facilities',
      'hazard',
      'reports',
    ]) {
      expect(ids).toContain(required)
    }
  })

  it('shows the basemap, wards, affected population, Plan response and roads by default', () => {
    const onByDefault = layerRegistry.filter((l) => l.defaultVisible).map((l) => l.id)
    expect(onByDefault).toEqual(
      expect.arrayContaining(['basemap', 'admin-district', 'admin-ward', 'affected-population', 'plan-response', 'roads']),
    )
  })

  it('hides all-organisations distributions by default, so the map is Plan-first', () => {
    const layer = layerRegistry.find((l) => l.id === 'distribution-all')
    expect(layer?.defaultVisible).toBe(false)
  })

  it('builds layer URLs from the filter object rather than a fixed path', () => {
    const layer = layerRegistry.find((l) => l.id === 'affected-population')
    const url = layer!.source.url({ district: 'Rasuwa', category: 'FOOD' })
    expect(url).toContain('district=Rasuwa')
    expect(url).toContain('category=FOOD')
  })

  it('shows wards only from zoom 9, so they do not clutter the national view', () => {
    const layer = layerRegistry.find((l) => l.id === 'admin-ward')
    expect(layer?.minZoom).toBe(9)
  })

  it('carries the mixed-unit caveat in the affected-population legend', () => {
    const layer = layerRegistry.find((l) => l.id === 'affected-population')
    expect(layer?.legend.note).toMatch(/double-count/i)
  })
})

describe('nav presets (spec 13.1)', () => {
  it('covers all eight V1 navigation items', () => {
    expect(navPresets.map((p) => p.id)).toEqual([
      'map',
      'situation',
      'affected',
      'plan-response',
      'access',
      'reports',
      'data',
      'dashboard',
    ])
  })

  it('references only layers that exist in the registry', () => {
    const ids = new Set(layerRegistry.map((l) => l.id))
    for (const preset of navPresets) {
      for (const layer of preset.layers) {
        expect(ids).toContain(layer)
      }
    }
  })

  it('has a unique id and href per preset', () => {
    expect(new Set(navPresets.map((p) => p.href)).size).toBe(navPresets.length)
  })

  it('defaults Plan Response to the primary organisation lens', () => {
    const preset = navPresets.find((p) => p.id === 'plan-response')
    expect(preset?.defaultFilters?.organisation).toBe('primary')
  })
})