import { AppHeader } from '@/components/shell/AppHeader'
import { NavBar } from '@/components/shell/NavBar'
import { MapShell } from '@/components/map/MapShell'
import { env } from '@/lib/env'
import { extentDistricts } from '@/lib/env'
import { corridorConfig } from '@nepal-flood-gis/core'

/**
 * Map is the default route (spec 13.1). Every other nav item is a preset of
 * layers and filters over this same shell, so the user never loses map context
 * by navigating.
 */
export default function MapPage() {
  return (
    <MapShell
      corridor={corridorConfig}
      extentDistricts={extentDistricts}
      // Phase 0 has no boundary data yet (risk R1, spec 19.3), so the shell
      // renders with an explicit notice rather than an empty-looking map that
      // could be mistaken for "no flooding reported".
      boundaryDataPending
      storageDriver={env.STORAGE_DRIVER}
    >
      <AppHeader />
      <NavBar activePreset="map" />
    </MapShell>
  )
}