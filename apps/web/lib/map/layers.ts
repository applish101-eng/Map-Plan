export interface LayerDef {
  id: string
  /**
   * Display grouping in the layer panel. Distinct from nav presets: SITUATION
   * is a preset that composes layers from several groups, not a group itself.
   */
  group:
    | 'population'
    | 'plan-response'
    | 'distribution'
    | 'roads'
    | 'facilities'
    | 'hazard'
    | 'reports'
    | 'admin'
    | 'waterways'
    | 'basemap'
  label: string
  /**
   * Built from the shared filter object rather than a fixed URL, so the same
   * filter drives every layer. Spec 10.2: the filter object is what stops the
   * map, table and dashboard from diverging.
   */
  source: { type: 'geojson' | 'vector' | 'pmtiles'; url: (filters: Record<string, unknown>) => string }
  style: unknown[]
  /**
   * The legend is generated from the layer definition, never hand-written
   * (spec 11.2). A hand-written legend drifts from the layer it describes.
   */
  legend: LegendSpec
  minZoom?: number
  maxZoom?: number
  interactive: boolean
  defaultVisible: boolean
  /** Spec 11.2: layers a Viewer must not see are gated server-side too. */
  requiresRole?: 'EDITOR' | 'ADMIN'
}

export interface LegendSpec {
  title: string
  /** Discrete classes, e.g. the six road statuses. */
  classes?: Array<{ label: string; color: string; lineStyle?: string }>
  /** Continuous ramp, e.g. the affected-population choropleth. */
  ramp?: Array<{ label: string; color: string }>
  /** Icon-only layer: shape carries the meaning, not colour. */
  symbols?: Array<{ label: string; icon: string }>
  note?: string
}

/**
 * Layer registry (spec 11.2, 11.3).
 *
 * Adding a layer must never require editing map core: a new entry here is
 * enough for it to appear in the layer panel, be toggleable, and get a legend.
 */
export const layerRegistry: LayerDef[] = [
  {
    id: 'basemap',
    group: 'basemap',
    label: 'Basemap',
    source: { type: 'pmtiles', url: () => '/api/v1/basemap-url' },
    style: [],
    legend: { title: 'Basemap', note: '© OpenStreetMap contributors' },
    interactive: false,
    defaultVisible: true,
  },
  {
    id: 'admin-district',
    group: 'admin',
    label: 'Districts',
    source: { type: 'geojson', url: (f) => `/api/v1/admin-areas?level=2&${toQuery(f)}` },
    style: [],
    legend: { title: 'Administrative boundaries', note: 'Authoritative boundary data' },
    minZoom: 4,
    maxZoom: 9,
    interactive: true,
    defaultVisible: true,
  },
  {
    id: 'admin-municipality',
    group: 'admin',
    label: 'Municipalities',
    source: { type: 'geojson', url: (f) => `/api/v1/admin-areas?level=3&${toQuery(f)}` },
    style: [],
    legend: { title: 'Municipalities' },
    minZoom: 9,
    maxZoom: 12,
    interactive: true,
    defaultVisible: true,
  },
  {
    id: 'admin-ward',
    group: 'admin',
    label: 'Wards',
    source: { type: 'geojson', url: (f) => `/api/v1/admin-areas?level=4&${toQuery(f)}` },
    style: [],
    legend: { title: 'Wards' },
    minZoom: 9,
    interactive: true,
    defaultVisible: true,
  },
  {
    id: 'affected-population',
    group: 'population',
    label: 'Affected population',
    source: { type: 'geojson', url: (f) => `/api/v1/wards/summary?${toQuery(f)}` },
    style: [],
    legend: {
      title: 'Affected population (people)',
      ramp: [
        { label: 'None reported', color: 'var(--ramp-none)' },
        { label: '1', color: 'var(--ramp-1)' },
        { label: '2', color: 'var(--ramp-2)' },
        { label: '3', color: 'var(--ramp-3)' },
        { label: '4-5 (highest)', color: 'var(--ramp-4)' },
      ],
      // Spec 8.5: reached totals are per-activity sums and may double-count.
      note: 'Reached totals are sums of per-activity beneficiary counts and may double-count the same person.',
    },
    minZoom: 6,
    interactive: true,
    defaultVisible: true,
  },
  {
    id: 'plan-response',
    group: 'plan-response',
    label: 'Plan International response',
    source: { type: 'geojson', url: (f) => `/api/v1/interventions?organisation=primary&${toQuery(f)}` },
    style: [],
    legend: { title: 'Plan International activities', symbols: [{ label: 'Distribution / activity', icon: 'location-distribution' }] },
    interactive: true,
    defaultVisible: true,
  },
  {
    id: 'distribution-all',
    group: 'distribution',
    label: 'Distributions (all organisations)',
    source: { type: 'geojson', url: (f) => `/api/v1/interventions?${toQuery(f)}` },
    style: [],
    legend: { title: 'All activities', symbols: [{ label: 'Activity', icon: 'location-distribution' }] },
    interactive: true,
    defaultVisible: false,
  },
  {
    id: 'roads',
    group: 'roads',
    label: 'Roads & access',
    source: { type: 'geojson', url: (f) => `/api/v1/roads?${toQuery(f)}` },
    style: [],
    legend: {
      title: 'Road access status',
      // Spec 12.3: line style carries the status as well as colour.
      classes: [
        { label: 'Open', color: 'var(--status-open)', lineStyle: 'solid' },
        { label: 'Restricted', color: 'var(--status-restricted)', lineStyle: 'dashed' },
        { label: '4WD only', color: 'var(--status-4wd)', lineStyle: 'dash-dot' },
        { label: 'Blocked', color: 'var(--status-blocked)', lineStyle: 'thick solid' },
        { label: 'Damaged', color: 'var(--status-damaged)', lineStyle: 'fine dashed' },
        { label: 'Unknown', color: 'var(--status-unknown)', lineStyle: 'dotted' },
      ],
      // The one ordering worth stating out loud.
      note: 'Unknown status is more restrictive than blocked: an unverified road is not assumed passable.',
    },
    interactive: true,
    defaultVisible: true,
  },
  {
    id: 'facilities',
    group: 'facilities',
    label: 'Facilities',
    source: { type: 'geojson', url: (f) => `/api/v1/facilities?${toQuery(f)}` },
    style: [],
    legend: {
      title: 'Facilities',
      symbols: [
        { label: 'Health facility', icon: 'location-health' },
        { label: 'Warehouse', icon: 'location-warehouse' },
        { label: 'Shelter', icon: 'location-shelter' },
        { label: 'Water point', icon: 'location-water' },
      ],
    },
    interactive: true,
    defaultVisible: false,
  },
  {
    id: 'hazard',
    group: 'hazard',
    label: 'Flood / hazard extent',
    source: { type: 'geojson', url: (f) => `/api/v1/hazard-areas?${toQuery(f)}` },
    style: [],
    legend: { title: 'Hazard extent', note: 'Time-stamped observational polygons' },
    interactive: true,
    defaultVisible: false,
  },
  {
    id: 'reports',
    group: 'reports',
    label: 'Reports',
    source: { type: 'geojson', url: (f) => `/api/v1/reports?${toQuery(f)}` },
    style: [],
    legend: { title: 'Reports', symbols: [{ label: 'Field report', icon: 'location-report' }] },
    interactive: true,
    defaultVisible: false,
  },
  {
    id: 'waterways',
    group: 'waterways',
    label: 'Rivers & waterways',
    source: { type: 'geojson', url: () => '/api/v1/waterways' },
    style: [],
    legend: { title: 'Waterways' },
    interactive: false,
    defaultVisible: false,
  },
]

function toQuery(f: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    params.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const layerById = (id: string) => layerRegistry.find((l) => l.id === id)

/**
 * Nav items are presets of layers + filters + columns over one map shell
 * (spec 13.1), not separate pages with separate maps.
 */
export type NavPreset = {
  id: string
  label: string
  href: string
  layers: string[]
  defaultFilters?: Record<string, unknown>
  columns?: string[]
}

export const navPresets: NavPreset[] = [
  {
    id: 'map',
    label: 'Map',
    href: '/',
    layers: ['admin-district', 'admin-ward', 'affected-population', 'plan-response', 'roads'],
  },
  {
    id: 'situation',
    label: 'Situation',
    href: '/situation',
    layers: ['admin-district', 'admin-municipality', 'admin-ward', 'affected-population', 'hazard', 'roads'],
  },
  {
    id: 'affected',
    label: 'Affected population',
    href: '/affected',
    layers: ['admin-ward', 'affected-population'],
    columns: ['ward', 'affected_people', 'affected_households', 'severity', 'verification', 'last_updated'],
  },
  {
    id: 'plan-response',
    label: 'Plan response',
    href: '/plan-response',
    layers: ['admin-ward', 'plan-response', 'roads'],
    defaultFilters: { organisation: 'primary' },
  },
  {
    id: 'access',
    label: 'Access',
    href: '/access',
    layers: ['admin-municipality', 'admin-ward', 'roads'],
    columns: ['road_name', 'access_status', 'reason', 'last_verified', 'source'],
  },
  {
    id: 'reports',
    label: 'Reports',
    href: '/reports',
    layers: ['reports', 'admin-ward'],
    columns: ['report_type', 'description', 'status', 'submitted_at', 'reviewed_by'],
  },
  {
    id: 'data',
    label: 'Data',
    href: '/data',
    layers: ['admin-ward', 'affected-population', 'plan-response'],
    columns: ['name', 'location_type', 'district', 'ward', 'verification', 'last_updated'],
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    layers: ['admin-district'],
  },
]