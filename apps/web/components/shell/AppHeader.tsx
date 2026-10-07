'use client'

import { useState } from 'react'
import { navPresets } from '@/lib/map/layers'

/**
 * Application header (spec 13.1).
 *
 * Contains: logo slot, project name, global search, organisation lens, user
 * menu. The organisation selector is the "Plan International only" one-click
 * filter that makes our own response instantly visible (spec 2.2) - it is
 * deliberately in the header rather than buried in the filter panel.
 *
 * Search and auth arrive in Phase 3/5; the controls are present and correctly
 * labelled but inert in Phase 0, with disabled state rather than fake data.
 */
export function AppHeader() {
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  return (
    <header
      className="no-print border-b border-line bg-surface-0"
      style={{ height: 'var(--header-height)' }}
    >
      <div className="flex h-full items-center gap-4 px-4">
        {/* Logo slot (spec 12.6). Configurable; ships as a wordmark placeholder. */}
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-corner bg-[var(--brand-blue)] text-sm font-bold text-white"
          >
            NP
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-ink-900">Nepal Flash-Flood Response</p>
            <p className="text-xs text-ink-500">Operational GIS</p>
          </div>
        </div>

        {/* Global search (spec 13.4). Grouped results, "/" to focus, arrow keys
            and Enter. Implemented in Phase 3. */}
        <div className="flex-1">
          <label htmlFor="global-search" className="sr-only-focusable">
            Search districts, municipalities, wards, locations, roads, activities and reports
          </label>
          <div className="relative max-w-xl">
            <input
              id="global-search"
              type="search"
              disabled
              placeholder="Search wards, locations, roads, activities… (Phase 3)"
              aria-describedby="global-search-hint"
              className="w-full rounded-corner border border-line bg-surface-100 px-3 py-1.5 text-sm text-ink-700 placeholder:text-ink-500 disabled:cursor-not-allowed"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-surface-0 px-1 text-xs text-ink-500">
              /
            </kbd>
          </div>
          <p id="global-search-hint" className="sr-only-focusable">
            Global search will search Nepali and English place names using trigram matching.
          </p>
        </div>

        {/* Organisation lens - one click to "Plan International only" (spec 2.2). */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOrgMenuOpen((v) => !v)}
            aria-expanded={orgMenuOpen}
            aria-haspopup="listbox"
            className="flex items-center gap-2 rounded-corner border border-line bg-surface-0 px-3 py-1.5 text-sm text-ink-900 hover:bg-surface-100"
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-[var(--brand-blue)]"
            />
            Org: Plan International
            <span aria-hidden="true" className="text-ink-500">
              ▾
            </span>
          </button>
          {orgMenuOpen ? (
            <ul
              role="listbox"
              aria-label="Organisation filter"
              className="panel-surface absolute right-0 top-full z-30 mt-1 w-64 p-1"
            >
              <li role="option" aria-selected="false">
                <button
                  type="button"
                  className="w-full rounded-corner px-2 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-100"
                >
                  All organisations
                </button>
              </li>
              <li role="option" aria-selected="true">
                <button
                  type="button"
                  className="w-full rounded-corner bg-[var(--brand-blue-50)] px-2 py-1.5 text-left text-sm font-medium text-ink-900"
                >
                  Plan International only
                </button>
              </li>
              {navPresets.length === 0 ? null : null}
            </ul>
          ) : null}
        </div>

        {/* User menu: role-gated actions only. RBAC is enforced server-side
            (spec 16.1); hiding items here is usability, not security. Auth
            arrives in Phase 5. */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-corner border border-line bg-surface-0 px-3 py-1.5 text-sm text-ink-900 hover:bg-surface-100"
          >
            User
            <span aria-hidden="true" className="text-ink-500">
              ▾
            </span>
          </button>
          {userMenuOpen ? (
            <div
              role="menu"
              className="panel-surface absolute right-0 top-full z-30 mt-1 w-56 p-1"
            >
              <p className="px-2 py-1.5 text-xs text-ink-500">Sign-in arrives in Phase 5</p>
              <p className="px-2 pb-1.5 text-xs text-ink-500">
                Roles: Viewer, Editor, Admin
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}