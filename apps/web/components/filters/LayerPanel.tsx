'use client'

import { useState } from 'react'
import { layerRegistry, type LayerDef } from '@/lib/map/layers'

/**
 * Layer panel (spec 11.1, 11.3).
 *
 * Rendered from the layer registry, so adding a layer to the registry is
 * enough for it to appear here with a generated legend (spec 11.2). Grouping
 * follows the registry's `group` field rather than a hard-coded list.
 *
 * Legend is rendered from the same definition the map layer uses. A
 * hand-written legend would drift from what is actually drawn.
 */

const groupLabels: Record<LayerDef['group'], string> = {
  basemap: 'Base',
  admin: 'Administrative boundaries',
  population: 'Population',
  'plan-response': 'Plan International response',
  distribution: 'Distributions',
  roads: 'Roads & access',
  facilities: 'Facilities',
  hazard: 'Hazard',
  reports: 'Reports',
  waterways: 'Waterways',
}

export function LayerPanel({
  visible,
  onToggle,
}: {
  visible: Record<string, boolean>
  onToggle: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const groups = [...new Set(layerRegistry.map((l) => l.group))]

  return (
    <div className="panel-surface overflow-hidden" data-testid="layer-panel">
      <div className="border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink-900">Layers</h2>
      </div>

      <div className="max-h-[calc(100vh-var(--header-height)-var(--nav-height)-6rem)] overflow-y-auto">
        {groups.map((group) => (
          <section key={group} className="border-b border-line last:border-b-0">
            <h3 className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {groupLabels[group]}
            </h3>
            <ul>
              {layerRegistry
                .filter((l) => l.group === group)
                .map((layer) => (
                  <li key={layer.id}>
                    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-100">
                      <input
                        id={`layer-${layer.id}`}
                        type="checkbox"
                        checked={visible[layer.id] ?? layer.defaultVisible}
                        onChange={() => onToggle(layer.id)}
                        className="size-4 accent-[var(--brand-blue)]"
                      />
                      <label
                        htmlFor={`layer-${layer.id}`}
                        className="flex-1 cursor-pointer text-sm text-ink-900"
                      >
                        {layer.label}
                      </label>
                      {layer.legend.classes?.length || layer.legend.ramp?.length || layer.legend.symbols?.length ? (
                        <button
                          type="button"
                          aria-label={`Legend for ${layer.label}`}
                          aria-expanded={expanded[layer.id] ?? false}
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [layer.id]: !prev[layer.id] }))
                          }
                          className="rounded-corner px-1 text-ink-500 hover:bg-surface-100 hover:text-ink-900"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
                            <path d="M2 4h12v8H2V4zm1 1v6h10V5H3z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>

                    {expanded[layer.id] ? (
                      <div className="px-3 pb-2 pl-9 text-xs text-ink-700">{renderLegend(layer)}</div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * Legend generated from the layer definition (spec 11.2).
 *
 * Road statuses and the affected ramp each carry a shape or line style as well
 * as a colour, so the legend does too - a colour-only swatch would not tell a
 * reader what the line style means.
 */
function renderLegend(layer: LayerDef) {
  return (
    <div className="space-y-1.5">
      {layer.legend.title ? <p className="font-semibold text-ink-900">{layer.legend.title}</p> : null}

      {layer.legend.ramp ? (
        <ul className="space-y-0.5">
          {layer.legend.ramp.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-[2px] print-preserve-colour"
                style={{ background: c.color, border: '1px solid var(--brand-yellow-700)' }}
              />
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {layer.legend.classes ? (
        <ul className="space-y-0.5">
          {layer.legend.classes.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span aria-hidden="true" className="w-6 shrink-0">
                <svg width="24" height="8" viewBox="0 0 24 8">
                  <line
                    x1="0"
                    y1="4"
                    x2="24"
                    y2="4"
                    stroke={c.color}
                    strokeWidth="2.5"
                    strokeDasharray={
                      c.lineStyle === 'dashed'
                        ? '4 2'
                        : c.lineStyle === 'dash-dot'
                          ? '8 2 2 2'
                          : c.lineStyle === 'fine dashed'
                            ? '1.5 1.5'
                            : c.lineStyle === 'dotted'
                              ? '0.5 3'
                              : undefined
                    }
                  />
                </svg>
              </span>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {layer.legend.symbols ? (
        <ul className="space-y-0.5">
          {layer.legend.symbols.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-3 shrink-0 items-center justify-center"
                data-icon={s.icon}
              />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {layer.legend.note ? <p className="text-ink-500">{layer.legend.note}</p> : null}
    </div>
  )
}