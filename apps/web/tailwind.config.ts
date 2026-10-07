/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'media',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/schemas/src/**/*.{ts,tsx}',
    '../../packages/core/src/**/*.{ts,tsx}',
  ],
  theme: {
    // Tokens replace the default palette wholesale (spec 12.3). Ad-hoc colours
    // are how the palette loses its meaning, so there is no `colors.blue.500`
    // to reach for: a colour must be a declared token or not exist.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: 'var(--surface-0)',
      black: 'var(--ink-900)',

      brand: {
        cyan: 'var(--brand-cyan)',
        blue: 'var(--brand-blue)',
        yellow: 'var(--brand-yellow)',
        'blue-700': 'var(--brand-blue-700)',
        'blue-50': 'var(--brand-blue-50)',
        'cyan-100': 'var(--brand-cyan-100)',
        'yellow-700': 'var(--brand-yellow-700)',
        'yellow-100': 'var(--brand-yellow-100)',
      },

      ink: {
        900: 'var(--ink-900)',
        700: 'var(--ink-700)',
        500: 'var(--ink-500)',
      },

      line: {
        DEFAULT: 'var(--line-300)',
        300: 'var(--line-300)',
      },

      surface: {
        0: 'var(--surface-0)',
        100: 'var(--surface-100)',
      },

      status: {
        open: 'var(--status-open)',
        restricted: 'var(--status-restricted)',
        '4wd': 'var(--status-4wd)',
        blocked: 'var(--status-blocked)',
        damaged: 'var(--status-damaged)',
        unknown: 'var(--status-unknown)',
        demo: 'var(--status-demo)',
      },

      ramp: {
        none: 'var(--ramp-none)',
        1: 'var(--ramp-1)',
        2: 'var(--ramp-2)',
        3: 'var(--ramp-3)',
        4: 'var(--ramp-4)',
      },

      // Deliberately absent: `text-brand-cyan` and `text-brand-yellow`.
      // Spec 12.2 - both fail contrast on a light background (1.9:1, 1.4:1).
      // Not omitting them by accident; see accent below for the sanctioned way
      // to render an accent on text.
      accent: 'var(--text-accent, var(--brand-blue))',
    },

    fontFamily: {
      sans: 'var(--font-sans)',
      devanagari: 'var(--font-devanagari)',
      numeric: 'var(--font-numeric)',
    },

    fontSize: {
      xs: ['var(--text-xs)', { lineHeight: '1.4' }],
      sm: ['var(--text-sm)', { lineHeight: '1.45' }],
      base: ['var(--text-base)', { lineHeight: '1.5' }],
      'metric-lg': ['var(--text-metric-lg)', { lineHeight: '1.1', fontWeight: '600' }],
      'metric-xl': ['var(--text-metric-xl)', { lineHeight: '1.05', fontWeight: '600' }],
    },

    borderRadius: {
      corner: 'var(--radius-corner)',
      md: 'var(--radius-corner)',
      lg: 'var(--radius-corner)',
    },

    spacing: {
      // 4px grid (spec 12.5). The scale replaces Tailwind's default rather than
      // extending it, so an off-grid value like py-3.5 is unavailable by
      // design - dense operational layouts do not want arbitrary half-steps.
      0: '0px',
      px: '1px',
      0.5: '2px',
      1: '4px',
      1.5: '6px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '20px',
      6: '24px',
      7: '28px',
      8: '32px',
      9: '36px',
      10: '40px',
      12: '48px',
      16: '64px',
      20: '80px',
      24: '96px',
      header: 'var(--header-height)',
      nav: 'var(--nav-height)',
      panel: 'var(--panel-width)',
      'panel-wide': 'var(--panel-width-wide)',
      rail: 'var(--filter-rail-width)',
      table: 'var(--table-height)',
    },

    transitionDuration: {
      fast: 'var(--duration-fast)',
      base: 'var(--duration-base)',
    },

    transitionTimingFunction: {
      standard: 'var(--easing-standard)',
    },

    boxShadow: {
      popover: 'var(--shadow-popover)',
      panel: 'var(--shadow-panel)',
    },

    // Breakpoints from spec 13.7.
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1200px',
      '2xl': '1536px',
    },
  },
  plugins: [],
}