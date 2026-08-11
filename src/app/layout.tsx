import type { Metadata } from "next"
import { JetBrains_Mono, Space_Grotesk } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"
import { siteMetadata } from "@/lib/metadata"

/**
 * Two typefaces, and the split between them is the rule the whole screen obeys.
 *
 * Every number the player reads — the countdown, the two prices, the score — is
 * a *quantity that changes in place*, so it is set in JetBrains Mono, whose
 * figures are the same width by construction. Inter's tabular figures got the
 * digits to stop shifting, but only the digits: an arcade countdown at 176px
 * also needs the glyphs to look machined, and a proportional face at that size
 * reads as a headline rather than as an instrument.
 *
 * Space Grotesk takes everything that is words. It is grotesque enough to sit
 * next to the mono without a seam, and it carries the two labels that have to
 * shout — UP and DOWN — better than Inter does.
 *
 * Both are self-hosted by `next/font`: no runtime request to Google, and no
 * layout shift while a webfont swaps in under a number that is counting down.
 */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
})

// Defined in `@/lib/metadata` so the board's header can read the same two
// strings without importing this file — see the note there.
export const metadata: Metadata = siteMetadata

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark-only, and now not merely dark but near-black: the arcade layout puts
    // a chart behind the whole screen and lets an amber glow bleed out of the
    // countdown, and both of those need a surface with nothing else on it.
    <html lang="en" className={`dark ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
