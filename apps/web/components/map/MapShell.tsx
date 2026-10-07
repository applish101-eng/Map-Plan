'use client'

import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { layerRegistry } from '@/lib/map/layers'
import type { CorridorConfig } from '@nepal-flood-gis/core'
import { LayerPanel } from '@/components/filters/LayerPanel'

/**
 * Application shell (spec 11.1, 13.1).
 *
 * Layout rule from spec principle 1: the map is the dominant element at every
 * breakpoint. Panels overlay it; the map is never shrunk to make room for
 * chrome. At <1200px the panel and table collapse to drawers and the map takes
 * the full viewport.
 */

export function MapShell({
  children,
  corridor,
  extentDistricts,
  boundaryDataPending,
  storageDriver,
}: {
  children: ReactNode
  corridor: CorridorConfig
  extentDistricts: string[]
  /**
   * Shown until Phase 1 ingests authoritative boundaries. Spec 19.3 forbids
   * fabricating ward polygons, so an empty map must be labelled as
   * "not yet loaded", never as "no flooding reported" - those two states look
   * identical to an operator and mean opposite things.
   */
  boundaryDataPending?: boolean
  storageDriver?: string
}) {
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(layerRegistry.map((l) => [l.id, l.defaultVisible])),
  )
  const [panelOpen, setPanelOpen] = useState(false)

  const toggleLayer = useCallback((id: string) => {
    setVisibleLayers((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* Chrome overlays the map rather than shrinking it. */}
      <div className="no-print relative z-20 flex flex-col">{children}</div>

      <div className="relative flex-1 min-h-0">
        {/* Map area. In Phase 1 this holds the MapLibre canvas; in Phase 0 it
            carries the boundary-data notice so the shell is reviewable. */}
        <div
          className="map-container bg-surface-100 print-preserve-colour"
          data-testid="map-container"
          data-layers={Object.entries(visibleLayers)
            .filter(([, on]) => on)
            .map(([id]) => id)
            .join(',')}
          role="application"
          aria-label="Response map"
        >
          <MapPlaceholder
            corridor={corridor}
            extentDistricts={extentDistricts}
            boundaryDataPending={boundaryDataPending}
            storageDriver={storageDriver}
          />
        </div>

        {/* Left rail: filters and layers, overlaying the map. */}
        <div className="no-print pointer-events-none absolute left-3 top-3 z-10 w-[var(--filter-rail-width)]">
          <div className="pointer-events-auto">
            <LayerPanel visible={visibleLayers} onToggle={toggleLayer} />
          </div>
        </div>

        {/* Right-hand panel placeholder: the location profile lives here in
            Phase 2 (spec 13.2). */}
        <div className="no-print pointer-events-none absolute right-3 top-3 z-10 hidden xl:block">
          <div className="panel-surface pointer-events-auto w-[var(--panel-width)] p-3">
            <p className="text-sm font-semibold text-ink-900">Location profile</p>
            <p className="mt-1 text-sm text-ink-700">
              Click any ward, settlement or facility to open its operational profile: who is affected, what was
              distributed, the access situation, and the full update history.
            </p>
          </div>
        </div>

        {/* Mobile: filters and layers as floating buttons (spec 13.7). */}
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="no-print xl:hidden absolute bottom-4 right-4 z-10 rounded-corner bg-[var(--brand-blue)] px-4 py-2 text-sm font-medium text-white shadow-popover"
        >
          {panelOpen ? 'Close layers' : 'Layers'}
        </button>

        {panelOpen ? (
          <div className="no-print absolute inset-x-3 bottom-16 z-10 xl:hidden">
            <LayerPanel visible={visibleLayers} onToggle={toggleLayer} />
          </div>
        ) : null}

        {/* ARIA live region: announces map selection to screen readers
            (spec 13.9). Empty in Phase 0; populated when the map exists. */}
        <div aria-live="polite" aria-atomic="true" className="sr-only-focusable" />
      </div>
    </div>
  )
}

/**
 * Phase 0 stand-in for the map. Deliberately explicit about state: it says
 * boundary data is pending and names the configured corridor, so a reviewer can
 * confirm the extent is configuration-driven (spec 1.4) rather than baked in.
 */
function MapPlaceholder({
  corridor,
  extentDistricts,
  boundaryDataPending,
  storageDriver,
}: {
  corridor: CorridorConfig
  extentDistricts: string[]
  boundaryDataPending?: boolean
  storageDriver?: string
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel-surface max-w-xl p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Phase 0</p>
        <h1 className="mt-1 text-metric-lg font-semibold text-ink-900">Map shell ready</h1>

        <p className="mt-3 text-sm text-ink-700">
          The application shell, design tokens, database schema and infrastructure are in place. The MapLibre canvas
          arrives in Phase 1, together with the boundary ingestion.
        </p>

        {boundaryDataPending ? (
          <div className="mt-4 rounded-corner border border-line bg-surface-100 p-3">
            <p className="text-sm font-medium text-ink-900">Boundary data not yet loaded</p>
            <p className="mt-1 text-sm text-ink-700">
              No administrative polygons are displayed. This is{' '}
              <strong>not</strong> an indication that no flooding has been reported - it means no authoritative
              boundary dataset has been ingested yet. Ward boundaries are never hand-drawn (spec 9.1).
            </p>
          </div>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-500">Corridor</dt>
          <dd className="tabular text-ink-900">{corridor.corridor.join(' → ')}</dd>

          <dt className="text-ink-500">Logistics origin</dt>
          <dd className="text-ink-900">{corridor.logisticsOrigin}</dd>

          <dt className="text-ink-500">Planned expansion</dt>
          <dd className="text-ink-900">{corridor.plannedExpansion.join(', ') || 'none'}</dd>

          <dt className="text-ink-500">Extent (config)</dt>
          <dd className="tabular text-ink-900" data-testid="extent-districts">
            {extentDistricts.join(', ')}
          </dd>

          <dt className="text-ink-500">Initial view</dt>
          <dd className="tabular text-ink-900">
            {corridor.initialView.center[0].toFixed(2)}, {corridor.initialView.center[1].toFixed(2)} @ z
            {corridor.initialView.zoom}
          </dd>

          <dt className="text-ink-500">Storage</dt>
          <dd className="text-ink-900">{storageDriver ?? 'fs'}</dd>
        </dl>
      </div>
    </div>
  )
}