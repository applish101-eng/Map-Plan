/* ==========================================================================
   Phase 0 e2e: the shell renders, tokens are applied, and the map stays dominant.

   Scope note: this does not test the map, the profile panel or any data. Those
   arrive in Phases 1-2. What it does test is the shell that everything else is
   built on, plus the three rules that are cheap to break and expensive to notice
   later: brand tokens applied, DEMO/boundary honesty, and no third-party tile
   requests.
   ========================================================================== */

import { test, expect } from '@playwright/test'

test.describe('Phase 0 shell', () => {
  test('serves the map shell with corridor configuration', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Map shell ready' })).toBeVisible()

    // Spec 1.4: the corridor is configuration, and the shell states what it is
    // configured with. If this is hard-coded in a component, this test is where
    // it shows up.
    await expect(page.getByTestId('extent-districts')).toHaveText('Rasuwa, Nuwakot, Dhading, Chitwan')
    await expect(page.getByText('Rasuwa → Nuwakot → Dhading → Chitwan')).toBeVisible()
  })

  test('does not present missing boundary data as "no flooding reported"', async ({ page }) => {
    await page.goto('/')

    // Spec 19.3 forbids fabricating geography. An empty map must be explicit
    // about which of two opposite situations it represents - these look
    // identical to an operator and mean completely different things.
    const notice = page.getByText('Boundary data not yet loaded')
    await expect(notice).toBeVisible()
    await expect(page.getByText(/not.*an indication that no flooding has been reported/i)).toBeVisible()
  })

  test('applies the three brand tokens', async ({ page }) => {
    await page.goto('/')

    // The map container sits on a token-derived background, so reading its
    // computed style proves tokens.css reached the browser - a missing token
    // file fails here rather than as an unstyled app.
    const background = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map-container"]')
      return el ? getComputedStyle(el).backgroundColor : ''
    })
    expect(background).not.toBe('')
    expect(background).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('shows all eight navigation items', async ({ page }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'Sections' })
    for (const label of [
      'Map',
      'Situation',
      'Affected population',
      'Plan response',
      'Access',
      'Reports',
      'Data',
      'Dashboard',
    ]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
  })

  test('marks the active nav item with aria-current, not colour alone', async ({ page }) => {
    await page.goto('/')

    // Spec 12.1 assigns blue to "active". Colour alone is not accessible, so the
    // state must also be in the accessibility tree.
    const active = page.getByRole('link', { name: 'Map', exact: true })
    await expect(active).toHaveAttribute('aria-current', 'page')
  })

  test('exposes the organisation lens in the header', async ({ page }) => {
    await page.goto('/')

    // Spec 2.2: the organisation filter is a first-class one-click lens, so it
    // belongs in the header rather than buried in the filter panel.
    await expect(page.getByRole('button', { name: /Org: Plan International/ })).toBeVisible()
  })

  test('layer panel toggles a layer and reflects it in the map container', async ({ page }) => {
    await page.goto('/')

    const roads = page.getByLabel('Roads & access', { exact: true })
    await expect(roads).toBeChecked()

    const container = page.getByTestId('map-container')
    const before = await container.getAttribute('data-layers')
    expect(before).toContain('roads')

    await roads.uncheck()
    const after = await container.getAttribute('data-layers')
    expect(after).not.toContain('roads')
  })

  test('generates a road-status legend with line styles, not just swatches', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Legend for Roads & access' }).click()

    const legend = page.getByTestId('layer-panel')
    for (const status of ['Open', 'Restricted', '4WD only', 'Blocked', 'Damaged', 'Unknown']) {
      await expect(legend.getByText(status, { exact: true })).toBeVisible()
    }

    // Spec 12.3: status is carried by dash pattern as well as colour. A legend
    // of solid colour swatches would fail greyscale printing and colour-vision
    // deficiency, and the shape is the only part that survives.
    //
    // Asserted on the attribute rather than visibility: an SVG <line> has no
    // layout box of its own, so toBeVisible() is always false for it. What
    // matters is that the dashes exist and that they are not all identical.
    const dashed = legend.locator('svg line[stroke-dasharray]')
    expect(await dashed.count()).toBeGreaterThanOrEqual(4)

    const patterns = new Set(await dashed.evaluateAll((els) => els.map((e) => e.getAttribute('stroke-dasharray'))))
    expect(patterns.size).toBeGreaterThanOrEqual(4)

    // The ordering rule from ADR-0003 must be stated where a user reads it.
    await expect(legend.getByText(/Unknown status is more restrictive than blocked/i)).toBeVisible()
  })

  test('states the double-counting caveat on the affected-population legend', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Legend for Affected population' }).click()

    // Risk R3: reached totals are per-activity sums. Saying "people reached"
    // without this caveat is how a humanitarian figure becomes wrong.
    await expect(page.getByText(/may double-count/i)).toBeVisible()
  })
})

test.describe('local-first guarantees (spec 3, 9.3)', () => {
  test('makes no third-party requests', async ({ page }) => {
    const thirdParty: string[] = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      const local = ['localhost', '127.0.0.1']
      // Not Google, not a public tile server, not a font CDN. Spec 12.5 forbids
      // external font CDNs in production; spec 9.3 forbids public tile servers.
      if (!local.includes(url.hostname)) thirdParty.push(req.url())
    })

    await page.goto('/', { waitUntil: 'networkidle' })

    expect(thirdParty).toEqual([])
  })

  test('requests no map tiles yet', async ({ page }) => {
    const tileRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (/\.(pbf|mvt|png|jpg|webp)(\?|$)/i.test(url) || /tiles?\//i.test(url)) {
        tileRequests.push(url)
      }
    })

    await page.goto('/', { waitUntil: 'networkidle' })

    // Phase 0 has no map. If this starts failing with tile requests, either the
    // map arrived early (good) or something is reaching a third-party tile
    // server (very bad). Both are worth knowing.
    expect(tileRequests).toEqual([])
  })
})

test.describe('accessibility basics (spec 12.2, 13.9)', () => {
  test('map container is exposed as an application region', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('application', { name: 'Response map' })).toBeVisible()
  })

  test('provides a polite live region for map selection announcements', async ({ page }) => {
    await page.goto('/')
    // Empty in Phase 0, populated when the map exists. It must already be in
    // the tree so Phase 1 does not have to remember to add it.
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1)
  })

  test('navigation is keyboard reachable', async ({ page }) => {
    await page.goto('/')

    const firstLink = page.getByRole('navigation', { name: 'Sections' }).getByRole('link').first()
    await firstLink.focus()
    await expect(firstLink).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Situation', exact: true })).toBeFocused()
  })

  test('disabled search explains itself rather than silently doing nothing', async ({ page }) => {
    await page.goto('/')

    const search = page.getByRole('searchbox')
    await expect(search).toBeDisabled()
    await expect(search).toHaveAttribute('placeholder', /Phase 3/)
  })
})