'use client'

import Link from 'next/link'
import { navPresets } from '@/lib/map/layers'

/**
 * Primary navigation (spec 13.1).
 *
 * Each item is a preset of layers + filters + columns over one shared map
 * shell, not a separate page with its own map. Active state uses brand blue
 * (hover / active / selected, spec 12.1) with an underline so the state is not
 * carried by colour alone.
 */
export function NavBar({ activePreset }: { activePreset: string }) {
  return (
    <nav
      aria-label="Sections"
      className="no-print border-b border-line bg-surface-0"
      style={{ height: 'var(--nav-height)' }}
    >
      <ul className="flex h-full items-stretch overflow-x-auto">
        {navPresets.map((preset) => {
          const active = preset.id === activePreset
          return (
            <li key={preset.id} className="flex">
              <Link
                href={preset.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex items-center whitespace-nowrap border-b-2 px-4 text-sm transition-colors duration-fast',
                  active
                    ? 'border-[var(--brand-blue)] font-semibold text-[var(--brand-blue)]'
                    : 'border-transparent text-ink-700 hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]',
                ].join(' ')}
              >
                {preset.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}