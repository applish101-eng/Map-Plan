import { z } from 'zod'
import {
  accessStatuses,
  confidenceLevels,
  deliveryStatuses,
  verificationStatuses,
} from './enums'

/**
 * Single schema source per entity (spec 19.6). These Zod schemas are the only
 * definition of a record's shape; the SQL columns mirror them and both the API
 * and the UI derive their types from here. A field added to the database must
 * be added here in the same change.
 */

// ---------------------------------------------------------------------------
// Geometry
//
// EPSG:4326 throughout (AD-9). Coordinates are [longitude, latitude] - the
// GeoJSON RFC 7946 order, which is the reverse of how humans read them and a
// reliable source of swapped coordinates in Nepal where lat/lon are close
// (28.x, 85.x).
// ---------------------------------------------------------------------------
export const positionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

export const pointSchema = z.object({ type: z.literal('Point'), coordinates: positionSchema })

/**
 * Nepal's national bounding box, used to reject impossible coordinates at
 * validation time (spec 14.3). Deliberately generous - it is a sanity check,
 * not a boundary test. A point inside the box but in the wrong district is
 * caught later as a WARNING.
 */
export const nepalBbox = {
  minLon: 80.05,
  minLat: 26.35,
  maxLon: 88.2,
  maxLat: 30.45,
} as const

export const pointWithinNepal = (lon: number, lat: number) =>
  lon >= nepalBbox.minLon &&
  lon <= nepalBbox.maxLon &&
  lat >= nepalBbox.minLat &&
  lat <= nepalBbox.maxLat

// ---------------------------------------------------------------------------
// Provenance
//
// Every operational record carries this (spec 15.2). Declared once and spread
// into each entity schema, so a table cannot gain a record type without
// gaining provenance fields too.
// ---------------------------------------------------------------------------
export const provenanceSchema = z.object({
  source: z.string().nullable().optional(),
  sourceOrganisationId: z.string().uuid().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  reportedAt: z.string().datetime().nullable().optional(),
  verifiedAt: z.string().datetime().nullable().optional(),
  verifiedBy: z.string().uuid().nullable().optional(),
  verificationStatus: z.enum(verificationStatuses).default('NEW'),
  confidence: z.enum(confidenceLevels).nullable().optional(),
  notes: z.string().nullable().optional(),
  /** Spec 19.4: every demo row must be flagged, and the flag must reach the UI. */
  isDemo: z.boolean().default(false),
  /** True when the geometry came from a ward centroid, not reported coordinates. */
  geometryDerived: z.boolean().default(false),
})

export type Provenance = z.infer<typeof provenanceSchema>

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export const locationSchema = provenanceSchema.extend({
  id: z.string().uuid(),
  externalId: z.string().nullable().optional(),
  name: z.string().min(1),
  nameNe: z.string().nullable().optional(),
  locationType: z.string().min(1),
  wardId: z.string().uuid().nullable().optional(),
  municipalityId: z.string().uuid().nullable().optional(),
  districtId: z.string().uuid().nullable().optional(),
  provinceId: z.string().uuid().nullable().optional(),
  coordinates: positionSchema.nullable(),
  description: z.string().nullable().optional(),
  operationalStatus: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const locationCreateSchema = locationSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial({ nameNe: true, wardId: true, municipalityId: true, districtId: true, provinceId: true })
  .extend({
    // Either coordinates or a ward reference; the import engine resolves a
    // centroid and sets geometryDerived when only the ward is given (spec 8.6).
    coordinates: positionSchema.nullable().optional(),
    wardId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.coordinates !== null || v.wardId, {
    message: 'A location needs coordinates, a ward, or both',
  })

export const populationRecordSchema = provenanceSchema.extend({
  id: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  wardId: z.string().uuid().nullable().optional(),
  affectedPeople: z.number().int().min(0).nullable().optional(),
  affectedHouseholds: z.number().int().min(0).nullable().optional(),
  children: z.number().int().min(0).nullable().optional(),
  olderPeople: z.number().int().min(0).nullable().optional(),
  peopleWithDisabilities: z.number().int().min(0).nullable().optional(),
  severity: z.number().int().min(1).max(5).nullable().optional(),
  asOfDate: z.string().date(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

/**
 * Households cannot exceed people. Enforced here as a warning-severity import
 * check (spec 14.3) and again as a CHECK constraint, so an acknowledged import
 * still cannot write an impossible record.
 */
export const populationCoherence = (v: {
  affectedPeople?: number | null
  affectedHouseholds?: number | null
}) =>
  v.affectedHouseholds === null ||
  v.affectedHouseholds === undefined ||
  v.affectedPeople === null ||
  v.affectedPeople === undefined ||
  v.affectedHouseholds <= v.affectedPeople

export const interventionSchema = provenanceSchema.extend({
  id: z.string().uuid(),
  externalId: z.string().nullable().optional(),
  activityDate: z.string().date(),
  organisationId: z.string().uuid(),
  locationId: z.string().uuid(),
  wardId: z.string().uuid().nullable().optional(),
  activityType: z.string().min(1),
  title: z.string().nullable().optional(),
  beneficiaries: z.number().int().min(0).nullable().optional(),
  householdsReached: z.number().int().min(0).nullable().optional(),
  deliveryStatus: z.enum(deliveryStatuses).default('COMPLETED'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const distributionItemSchema = provenanceSchema.extend({
  id: z.string().uuid(),
  interventionId: z.string().uuid(),
  categoryCode: z.string().min(1),
  itemTypeId: z.string().uuid().nullable().optional(),
  itemLabel: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.string().min(1),
  beneficiaries: z.number().int().min(0).nullable().optional(),
  householdsReached: z.number().int().min(0).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const roadSegmentSchema = provenanceSchema.extend({
  id: z.string().uuid(),
  roadName: z.string().min(1),
  routeId: z.string().uuid().nullable().optional(),
  fromLocationId: z.string().uuid().nullable().optional(),
  toLocationId: z.string().uuid().nullable().optional(),
  accessStatus: z.enum(accessStatuses).default('UNKNOWN'),
  reason: z.string().nullable().optional(),
  lastVerified: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const reportSchema = z.object({
  id: z.string().uuid(),
  reportType: z.string().min(1),
  description: z.string().min(1),
  locationId: z.string().uuid().nullable().optional(),
  wardId: z.string().uuid().nullable().optional(),
  coordinates: positionSchema.nullable().optional(),
  status: z.enum(verificationStatuses).default('NEW'),
  submittedBy: z.string().uuid().nullable().optional(),
  submittedAt: z.string().datetime(),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  reviewNotes: z.string().nullable().optional(),
  promotedEntityType: z.string().nullable().optional(),
  promotedEntityId: z.string().uuid().nullable().optional(),
  isDemo: z.boolean().default(false),
})

export type Location = z.infer<typeof locationSchema>
export type PopulationRecord = z.infer<typeof populationRecordSchema>
export type Intervention = z.infer<typeof interventionSchema>
export type DistributionItem = z.infer<typeof distributionItemSchema>
export type RoadSegment = z.infer<typeof roadSegmentSchema>
export type Report = z.infer<typeof reportSchema>