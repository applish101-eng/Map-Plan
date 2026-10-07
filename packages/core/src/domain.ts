/**
 * Corridor configuration.
 *
 * Spec 1.4: the extent Rasuwa -> Nuwakot -> Dhading -> Chitwan, with Kathmandu
 * as the logistics origin and Gorkha planned, MUST NOT be hard-coded anywhere.
 * The schema and UI are extent-agnostic; this file is configuration.
 *
 * The values below are district names, not codes, because the codes depend on
 * the boundary dataset that Phase 1 will ingest (risk R1). Resolve names to
 * ids at ingest time rather than guessing P-codes now.
 */

export type CorridorConfig = {
  /** Operational corridor, in logistics order from origin outward. */
  corridor: readonly string[]
  /** Where relief enters the country / moves from. */
  logisticsOrigin: string
  /** Planned but not yet in scope. */
  plannedExpansion: readonly string[]
  /**
   * Initial map viewport [west, south, east, north] over the Bagmati
   * corridor. Generous enough to include Kathmandu as the origin, tightened
   * in Phase 1 once real boundaries are available and the extent can be
   * derived from the data instead.
   */
  initialView: {
    center: [number, number]
    zoom: number
    bbox?: [number, number, number, number]
  }
}

export const corridorConfig: CorridorConfig = {
  corridor: ['Rasuwa', 'Nuwakot', 'Dhading', 'Chitwan'],
  logisticsOrigin: 'Kathmandu',
  plannedExpansion: ['Gorkha'],
  initialView: {
    center: [85.32, 27.85],
    zoom: 9,
  },
}

/**
 * Primary organisation (spec 2.2).
 *
 * The organisation lens is a first-class one-click filter, which means the
 * product must know which organisation "ours" is without the UI hard-coding a
 * string. Resolved from app.organisations.is_primary at runtime; this is only
 * the fallback used before the seed has run.
 */
export const PRIMARY_ORG_NAME = 'Plan International Nepal'

/**
 * Province containment.
 *
 * Spec 1.4 notes that all four corridor districts are in Bagmati Province
 * while Gorkha is in Gandaki. Recorded so that a configuration mistake shows up
 * as a visible mismatch rather than a silently wrong label.
 */
export const provinceByDistrict: Record<string, string> = {
  Rasuwa: 'Bagmati',
  Nuwakot: 'Bagmati',
  Dhading: 'Bagmati',
  Chitwan: 'Bagmati',
  Kathmandu: 'Bagmati',
  Gorkha: 'Gandaki',
}