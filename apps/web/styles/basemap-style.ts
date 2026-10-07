/**
 * Basemap style (spec 9.3).
 *
 * A style JSON that references the local PMTiles archive through a pmtiles://
 * source. Swapping basemaps is swapping MAP_STYLE_URL (or PMTILES_URL) - no
 * code change, and no dependency on the humanitarian data model.
 *
 * Attribution is required and must survive into the UI: "© OpenStreetMap
 * contributors". The MapLibre default attribution control is suppressed in
 * globals.css and replaced by the app's own, which also carries the DEMO DATA
 * banner.
 *
 * Deliberately NOT used in production: tile.openstreetmap.org. Spec 9.3 forbids
 * it - it sends a tile request to a third party on every pan and zoom, and
 * fails outright in the field where connectivity is the constraint.
 *
 * Typed with MapLibre's own StyleSpecification so a malformed layer expression
 * is a compile error rather than a silently blank basemap.
 */

import type { StyleSpecification } from 'maplibre-gl'

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'

export const basemapStyle: StyleSpecification = {
  version: 8,
  name: 'Nepal Response - muted basemap',
  // Muted on purpose: the brand-coloured operational layers must dominate. A
  // high-contrast basemap competes with the data for attention.
  sources: {
    nepal: {
      type: 'vector',
      // Resolved at runtime by /api/v1/basemap-url, which reads PMTILES_URL from
      // configuration and serves it from local storage. The pmtiles:// scheme is
      // registered by the PMTiles plugin before the style is applied.
      url: 'pmtiles:///data/nepal.pmtiles',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': [
          'match',
          ['coalesce', ['get', 'mode'], 'light'],
          'dark',
          '#0b1f33',
          '#f4f7fa',
        ],
      },
    },
  ],
  // Operational layers are added by LayerManager from the layer registry, so the
  // basemap style and the data model stay decoupled (spec principle 10).
  glyphs: '/api/v1/glyphs/{fontstack}/{range}.pbf',
}

export default basemapStyle