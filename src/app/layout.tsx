import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/**
 * One typeface for everything, prices included.
 *
 * Inter's tabular figures keep the digits from shifting as the price ticks, so
 * a monospace face buys nothing here beyond a second font to download.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HODL On A Minute",
  description: "A 60-second BTC prediction game",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark-first, and only dark for now. The palette the game borrows — a warm
    // amber trace over near-black — is built for it, and a light variant would
    // be a second design to maintain for no one's benefit today.
    <html
      lang="en"
      className={`dark ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
