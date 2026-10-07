import type { Metadata, Viewport } from 'next'
import { Noto_Sans, Noto_Sans_Devanagari, IBM_Plex_Mono } from 'next/font/google'
import '@/styles/tokens.css'
import '@/styles/globals.css'

/**
 * Fonts are self-hosted by next/font at build time and served from the app's
 * own origin - spec 12.5 requires no external font CDN in production.
 *
 * Devanagari is not optional: admin_areas.name_ne and ops.locations.name_ne
 * hold Nepali place names, and the Search feature (spec 13.4) queries them.
 */
const notoSans = Noto_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-sans',
  display: 'swap',
})

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-devanagari',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-numeric',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Nepal Flash-Flood Response',
    template: '%s · Nepal Flash-Flood Response',
  },
  description:
    'Location-level operational profile for the Rasuwa-Nuwakot-Dhading-Chitwan flash-flood response: affected population, Plan International activities, distributions, road access and evidence.',
  // Spec 12.6: configurable logo slot. Replaced with the project's mark.
  applicationName: 'Nepal Flash-Flood Response',
  // Humanitarian operational data: not for public indexing. Spec 20 decision D2
  // defaults to no public access at all, and robots.txt reinforces it.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1f33' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${notoSans.variable} ${notoDevanagari.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  )
}