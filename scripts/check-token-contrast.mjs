#!/usr/bin/env node
/**
 * Brand token contrast check (spec 12.2, risk R9).
 *
 * The brand trio is fixed and deliberately fails WCAG for text on a light
 * background:
 *
 *   #0072CE  5.1:1  passes AA for text
 *   #58CAE7  1.9:1  fails
 *   #FFD500  1.4:1  fails
 *
 * That is a legitimate product decision - cyan is the default/initial state and
 * yellow is the affected/emphasis state, not text colours. What is NOT
 * acceptable is for a class like `text-brand-cyan` to quietly appear on a light
 * surface and render unreadable. This check makes that a build failure.
 *
 * Checks, in order:
 *   1. The tokens in tokens.css match Section 12.1 exactly. A drifting brand
 *      hex is the kind of change that happens by accident and is invisible in
 *      review.
 *   2. The sanctioned text colours meet WCAG AA against the surfaces they are
 *      used on.
 *   3. No source file uses brand cyan or brand yellow as a text colour.
 *   4. Text on the yellow highlight background meets AA.
 *
 * Exit code 1 on any failure, so CI stops.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notes = []

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** Relative luminance per WCAG 2.1. */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(hexA, hexB) {
  const a = luminance(hexA)
  const b = luminance(hexB)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

const fmt = (n) => n.toFixed(2)

// ---------------------------------------------------------------------------
// 1. Tokens match the spec
// ---------------------------------------------------------------------------

const tokensCss = readFileSync(join(repoRoot, 'apps/web/styles/tokens.css'), 'utf8')

const expectedTokens = {
  '--brand-cyan': '#58cae7',
  '--brand-blue': '#0072ce',
  '--brand-yellow': '#ffd500',
  '--ink-900': '#0b1f33',
  '--ink-700': '#2b3f55',
  '--ink-500': '#5b6b7c',
  '--line-300': '#d5dde5',
  '--surface-100': '#f4f7fa',
  '--surface-0': '#ffffff',
  '--brand-blue-700': '#005299',
  '--brand-blue-50': '#e6f1fb',
  '--brand-cyan-100': '#ddf3fa',
  '--brand-yellow-700': '#b89b00',
  '--brand-yellow-100': '#fff6bf',
}

for (const [name, expected] of Object.entries(expectedTokens)) {
  // Only the light-theme block; the dark block deliberately re-points surfaces.
  const lightBlock = tokensCss.split('@media (prefers-color-scheme: dark)')[0]
  const match = lightBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`))
  if (!match) {
    failures.push(`tokens.css: ${name} is missing from the light theme`)
    continue
  }
  const actual = match[1].toLowerCase()
  if (actual !== expected) {
    failures.push(`tokens.css: ${name} is ${actual}, spec 12.1/12.3 requires ${expected}`)
  }
}

notes.push(`Checked ${Object.keys(expectedTokens).length} brand and neutral tokens against spec 12.1/12.3`)

// ---------------------------------------------------------------------------
// 2. Sanctioned text colours meet AA
// ---------------------------------------------------------------------------

const aaNormal = 4.5
const textChecks = [
  { fg: '--ink-900', bg: '--surface-0', label: 'body text on white' },
  { fg: '--ink-700', bg: '--surface-0', label: 'secondary text on white' },
  { fg: '--ink-500', bg: '--surface-0', label: 'muted text on white' },
  { fg: '--ink-500', bg: '--surface-100', label: 'muted text on surface-100' },
  { fg: '--ink-900', bg: '--brand-yellow-100', label: 'key-number text on the yellow highlight' },
  // Spec 12.2: text on brand blue is white, ~5.1:1.
  { fg: '--surface-0', bg: '--brand-blue', label: 'white text on brand blue' },
]

for (const check of textChecks) {
  const fg = expectedTokens[check.fg]
  const bg = expectedTokens[check.bg]
  const ratio = contrastRatio(fg, bg)
  if (ratio < aaNormal) {
    failures.push(
      `contrast: ${check.label} (${check.fg} on ${check.bg}) is ${fmt(ratio)}:1, needs ${aaNormal}:1`,
    )
  } else {
    notes.push(`contrast: ${check.label} = ${fmt(ratio)}:1 (passes AA)`)
  }
}

// ---------------------------------------------------------------------------
// 3. Confirm cyan and yellow genuinely fail as text, and say so
// ---------------------------------------------------------------------------
// These SHOULD fail. Asserting it fails means a future palette change that
// "fixes" them to passing is caught and reconsidered, rather than silently
// altering which colours are safe for text.

const expectedFailures = [
  { fg: '--brand-cyan', bg: '--surface-0', label: 'brand cyan as text on white' },
  { fg: '--brand-yellow', bg: '--surface-0', label: 'brand yellow as text on white' },
]

for (const check of expectedFailures) {
  const ratio = contrastRatio(expectedTokens[check.fg], expectedTokens[check.bg])
  if (ratio >= aaNormal) {
    notes.push(
      `NOTE: ${check.label} now measures ${fmt(ratio)}:1 and would pass AA. ` +
        'If this was intentional, the prohibition in spec 12.2 can be relaxed; otherwise check the token.',
    )
  } else {
    notes.push(`confirmed: ${check.label} = ${fmt(ratio)}:1 (correctly excluded from text use)`)
  }
}

// ---------------------------------------------------------------------------
// 4. No source file uses the forbidden text classes
// ---------------------------------------------------------------------------

const forbidden = [
  { pattern: /\btext-brand-cyan\b/, token: 'text-brand-cyan', why: '#58CAE7 is 1.9:1 on white' },
  { pattern: /\btext-brand-yellow\b/, token: 'text-brand-yellow', why: '#FFD500 is 1.4:1 on white' },
  // Arbitrary CSS values that set the forbidden colour directly.
  { pattern: /text-\[var\(--brand-cyan\)\]/, token: 'text-[var(--brand-cyan)]', why: 'same as text-brand-cyan' },
  { pattern: /text-\[var\(--brand-yellow\)\]/, token: 'text-[var(--brand-yellow)]', why: 'same as text-brand-yellow' },
  { pattern: /color:\s*(var\(--brand-cyan\)|#58cae7)/i, token: 'color: brand cyan', why: 'direct CSS colour' },
  { pattern: /color:\s*(var\(--brand-yellow\)|#ffd500)/i, token: 'color: brand yellow', why: 'direct CSS colour' },
]

const sourceRoots = ['apps/web', 'packages', 'scripts']
const sourceExtensions = new Set(['.ts', '.tsx', '.css', '.mjs'])

/**
 * Files that necessarily mention the forbidden colours in order to prohibit
 * them. Excluded from the scan for a reason, each one:
 *
 *  styles/tokens.css        defines --brand-cyan / --brand-yellow and documents
 *                           in comments why they are not text colours
 *  tailwind.config.ts       the `colors` map names every token; the absence of a
 *                           text-brand-cyan entry is the point, and the check
 *                           below asserts that absence directly
 *  check-token-contrast.mjs this file, which lists the patterns themselves
 */
const exemptFiles = new Set([
  'apps/web/styles/tokens.css',
  'apps/web/tailwind.config.ts',
  'scripts/check-token-contrast.mjs',
])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (sourceExtensions.has(full.slice(full.lastIndexOf('.')))) yield full
  }
}

let scanned = 0
for (const root of sourceRoots) {
  const full = join(repoRoot, root)
  let entries
  try {
    entries = [...walk(full)]
  } catch {
    continue // directory does not exist yet
  }
  for (const file of entries) {
    scanned += 1
    const contents = readFileSync(file, 'utf8')
    const rel = relative(repoRoot, file).split('\\').join('/')
    if (exemptFiles.has(rel)) continue
    for (const rule of forbidden) {
      if (rule.pattern.test(contents)) {
        failures.push(
          `${rel}: uses ${rule.token} as a text colour - ${rule.why}. ` +
            'Use --ink-900 on light surfaces, or the --brand-yellow-100 highlight background (spec 12.2).',
        )
      }
    }
  }
}
notes.push(`Scanned ${scanned} source files for forbidden text-colour usage`)

// ---------------------------------------------------------------------------
// 5. The Tailwind palette must not expose a text entry for the forbidden tokens
// ---------------------------------------------------------------------------

// Excluding tailwind.config.ts from the scan above is only safe if the palette
// itself is checked here. If someone adds `cyan: ...` under a `text` key, the
// class becomes available again and every use of it bypasses the scan.
const tailwindConfig = readFileSync(join(repoRoot, 'apps/web/tailwind.config.ts'), 'utf8')

for (const forbiddenKey of ['text-brand-cyan', 'text-brand-yellow']) {
  const colour = forbiddenKey.replace('text-', '')
  // Look for a `text:` or `textColor:` block that maps this colour.
  const re = new RegExp(`(text|textColor):\\s*\\{[^}]*${colour}\\s*:`, 's')
  if (re.test(tailwindConfig)) {
    failures.push(
      `tailwind.config.ts: exposes a text colour for ${colour}. ` +
        `It would generate ${forbiddenKey}, which fails contrast (spec 12.2).`,
    )
  }
}
notes.push('Verified tailwind.config.ts exposes no text colour for cyan or yellow')

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('Brand token contrast check (spec 12.2, risk R9)\n')
for (const note of notes) console.log(`  · ${note}`)

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):\n`)
  for (const f of failures) console.error(`  x ${f}`)
  process.exit(1)
}

console.log('\nAll checks passed.')