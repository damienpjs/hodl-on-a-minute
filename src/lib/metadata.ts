import type { Metadata } from "next"

/**
 * The app's name, its one-line pitch and its mark, written down once.
 *
 * Two places need these strings and they must not drift: the document head,
 * which is what a link preview and a browser tab show, and the board's own
 * header, which is what the player reads. Keeping them in `layout.tsx` would
 * mean a client component importing the root layout — and with it `next/font`
 * and `globals.css` — to read two strings, so they live here and the layout
 * re-exports them as its `metadata`.
 *
 * The icon is declared here rather than dropped in as `app/icon.svg`, which is
 * the Next file convention, for the same reason: the convention would serve the
 * mark at a hashed route only the head can name, and the header and the README
 * need a path they can link to. One file in `public/`, three consumers.
 *
 * `as const satisfies Metadata` rather than `: Metadata`: the annotation would
 * widen `title` to Next's `string | TemplateString | null | undefined`, which
 * is not something you can drop into JSX without narrowing it first. This way
 * the object is still checked against `Metadata`, and both fields stay the
 * literal strings they are.
 */
export const siteMetadata = {
  title: "HODL On A Minute...",
  description: "A 60-second BTC prediction game",
  // A lone SVG, no `.ico` fallback: the browsers this is built for all read
  // one, and `sizes: "any"` is what tells them to stop looking for the raster
  // sizes that a vector does not need.
  icons: { icon: [{ url: "/logo.svg", type: "image/svg+xml", sizes: "any" }] },
} as const satisfies Metadata
