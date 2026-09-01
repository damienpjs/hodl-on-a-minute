import type { PriceTick } from "@/hooks/use-live-price";
import { RESOLUTION_DELAY_MS } from "@/lib/game";
import { cn } from "@/lib/utils";

/**
 * The live price trace, drawn from the ticks we already receive.
 *
 * Deliberately hand-rolled rather than a charting library. What this needs to
 * show is one bet over ninety seconds — a polyline, a few round price levels and
 * two guides. A canvas library would add a large dependency, break the jsdom
 * tests, and hide the only part worth explaining.
 *
 * The trace is an SVG stretched to the container; the levels and their labels
 * are HTML positioned by percentage. That split is deliberate: the SVG uses
 * `preserveAspectRatio="none"`, which would stretch any text drawn inside it.
 */

/** How much history the trace shows. Wider than a round, so the entry is visible. */
export const CHART_WINDOW_MS = 120_000;

// A fixed coordinate space for the trace, stretched to the container. Stroke
// widths stay honest via `vectorEffect`, so the non-uniform scale never thickens
// the line.
const VIEW_W = 1000;
const VIEW_H = 300;

/** Keeps a flat market from rendering as a zero-height domain. */
const MIN_PRICE_SPAN = 0.5;

/** Roughly how many round price levels to aim for. */
const TARGET_LEVELS = 4;

/**
 * How close a price level may come to the entry line before it is dropped, in
 * view units (the frame is `VIEW_H` = 300 tall).
 *
 * Two dashed horizontals eight units apart do not read as two lines, they read
 * as one badly drawn one — and the one that loses is the entry, because it is
 * the only line on the chart the player has money on. The grid is decoration
 * and can afford to give way; a round number missing from the scale costs
 * nothing, a smudged entry line costs the round.
 */
const LEVEL_ENTRY_CLEARANCE = 22;

/**
 * How close a level may come to the top or bottom of the frame, as a percentage.
 *
 * Its label is centred on the line, so a level at 1% has half its digits above
 * the edge of the screen. The domain is padded by 15% either side, so dropping
 * the outermost band never removes a level the trace is actually near.
 */
const LEVEL_EDGE_MARGIN_PCT = 7;

/**
 * Where the trace is being drawn, which is the only thing that changes about it.
 *
 * - `panel`     — a chart. Price levels labelled, entry price called out in a
 *                 chip, the trace as the loudest thing in its box.
 * - `wallpaper` — the surface the arcade screen is written on. Same geometry,
 *                 but stacked around a scrim so the board's text stays readable
 *                 over the trace, with the marks that carry information kept
 *                 deliberately above that scrim.
 *
 * Two render functions, one `computeGeometry`. The split is by *how the marks
 * are stacked*, which is genuinely different between the two and was becoming
 * unreadable as one tree full of `isWallpaper ?` ternaries. The scaling — the
 * only part that can be subtly wrong — stays shared, and is what the tests
 * point at.
 */
export type TickChartVariant = "panel" | "wallpaper";

export type TickChartProps = {
  ticks: PriceTick[];
  entryPrice?: number;
  entryAt?: number;
  now: number;
  variant?: TickChartVariant;
  className?: string;
};

export type PriceLevel = {
  price: number;
  /** y in view units, for the rule drawn inside the SVG. */
  y: number;
  /** The same line as a percentage from the top, for the HTML label. */
  topPct: number;
};

export type ChartGeometry = {
  line: string;
  area: string;
  /** y of the entry-price line in view units, or null when no guess is live. */
  entryY: number | null;
  /** Same line as a percentage from the top, for the HTML label. */
  entryTopPct: number | null;
  /** x of the 60-second mark, or null when it sits outside the window. */
  targetX: number | null;
  levels: PriceLevel[];
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * Grid labels: no symbol, no cents.
 *
 * These are round numbers by construction — `niceStep` only ever produces
 * multiples of 1, 2 or 5 × 10ⁿ — so the cents are always ".00" and the currency
 * is stated three times over on the rest of the screen. At 9px, "$64,750.00" is
 * more punctuation than number.
 */
const grid = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * A step from the 1 / 2 / 5 × 10ⁿ family — the reason chart gridlines land on
 * numbers a human would have chosen, instead of on $64,873.41.
 */
export function niceStep(span: number, targetCount = TARGET_LEVELS): number {
  const raw = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Exported for testing: the scaling is the only part that can be subtly wrong,
 * and it is much easier to assert on numbers than on rendered SVG.
 */
export function computeGeometry({
  ticks,
  entryPrice,
  entryAt,
  now,
}: Omit<TickChartProps, "className" | "variant">): ChartGeometry | null {
  const from = now - CHART_WINDOW_MS;
  const visible = ticks.filter((tick) => tick.at >= from && tick.at <= now);

  if (visible.length < 2) return null;

  const prices = visible.map((tick) => tick.price);
  // The entry line must never sit outside the drawing area, so it takes part in
  // the domain even when the market has moved well past it.
  if (entryPrice !== undefined) prices.push(entryPrice);

  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = Math.max(high - low, MIN_PRICE_SPAN);
  const padding = span * 0.15;
  const yMin = low - padding;
  const yMax = high + padding;

  const toX = (at: number) => ((at - from) / CHART_WINDOW_MS) * VIEW_W;
  const toY = (price: number) =>
    VIEW_H - ((price - yMin) / (yMax - yMin)) * VIEW_H;
  const toTopPct = (price: number) => (toY(price) / VIEW_H) * 100;

  // In the first two minutes the feed has not filled the window yet, and the
  // trace would start mid-frame against a stretch of empty background. Holding
  // the oldest sample flat back to the left edge fills the frame. The segment is
  // flat because we have no data there, not because the market stood still — it
  // carries no price of its own, so it cannot move the domain or mislead about a
  // direction.
  const first = visible[0];
  const trace =
    first.at > from ? [{ at: from, price: first.price }, ...visible] : visible;

  const points = trace.map((tick) => `${toX(tick.at)},${toY(tick.price)}`);
  const start = trace[0];
  const last = trace[trace.length - 1];

  const targetAt = entryAt === undefined ? null : entryAt + RESOLUTION_DELAY_MS;
  const targetIsVisible =
    targetAt !== null && targetAt >= from && targetAt <= now;

  const entryY = entryPrice === undefined ? null : toY(entryPrice);

  const step = niceStep(yMax - yMin);
  const levels: PriceLevel[] = [];
  for (
    let price = Math.ceil(yMin / step) * step;
    price <= yMax && levels.length < 6;
    price += step
  ) {
    // Floating-point addition drifts; round back onto the step grid so labels
    // read "$64,870" rather than "$64,869.999999".
    const snapped = Math.round(price / step) * step;
    const y = toY(snapped);
    const topPct = (y / VIEW_H) * 100;

    // Two reasons to drop a level, both about the thing next to it rather than
    // about the level itself: it would be drawn on top of the entry line, or
    // its label would be half off the edge of the frame.
    if (entryY !== null && Math.abs(y - entryY) < LEVEL_ENTRY_CLEARANCE)
      continue;
    if (
      topPct < LEVEL_EDGE_MARGIN_PCT ||
      topPct > 100 - LEVEL_EDGE_MARGIN_PCT
    ) {
      continue;
    }

    levels.push({ price: snapped, y, topPct });
  }

  return {
    line: points.join(" "),
    area: `M ${toX(start.at)},${VIEW_H} L ${points.join(" L ")} L ${toX(last.at)},${VIEW_H} Z`,
    entryY,
    entryTopPct: entryPrice === undefined ? null : toTopPct(entryPrice),
    targetX: targetIsVisible ? toX(targetAt) : null,
    levels,
  };
}

export function TickChart({
  className,
  variant = "panel",
  ...input
}: TickChartProps) {
  const geometry = computeGeometry(input);

  if (!geometry) return null;

  return variant === "wallpaper" ? (
    <Wallpaper geometry={geometry} className={className} />
  ) : (
    <Panel
      geometry={geometry}
      entryPrice={input.entryPrice}
      className={className}
    />
  );
}

/**
 * The chart as the surface the board is written on.
 *
 * Three layers, and the order is the whole point:
 *
 * 1. **the trace** — decoration. It shows the shape of the last two minutes and
 *    the player never has to read a value off it.
 * 2. **the scrim** — a downward-darkening wash that buys back the contrast the
 *    trace costs the text above it.
 * 3. **the guides** — the grid and the entry line, drawn *over* the scrim.
 *
 * Layer 3 is the correction. These used to be painted with the trace, under the
 * scrim, and by the time a 1px dashed rule had been through a 50-to-86% wash it
 * was not there at all. The scrim exists to hold back a squiggle, not to hide
 * the price levels the player is meant to read — so the marks that carry
 * information come out from under it.
 */
function Wallpaper({
  geometry,
  className,
}: {
  geometry: ChartGeometry;
  className?: string;
}) {
  return (
    // Decorative in full, level labels included: the numbers on the board
    // already announce the current and entry prices, so a screen reader reading
    // out four more would be noise. Nothing in here is interactive.
    <div
      className={cn("relative size-full", className)}
      aria-hidden="true"
      data-testid="tick-chart"
      data-variant="wallpaper"
    >
      {/* 1 — the trace. */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        // The full amber, held back by opacity rather than by a paler tint: a
        // washed-out amber over near-black goes muddy, while the same amber
        // faded keeps its hue and simply sits further away.
        className="absolute inset-0 size-full text-[var(--arcade-amber)]"
        data-testid="tick-chart-trace"
      >
        <defs>
          <linearGradient
            id="tick-chart-fade-wallpaper"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={geometry.area} fill="url(#tick-chart-fade-wallpaper)" />

        <polyline
          points={geometry.line}
          fill="none"
          stroke="currentColor"
          // Thicker here than in the panel, not thinner. It is spread across the
          // full width of a display, and a 2px line at that scale dissolves into
          // the background instead of receding into it.
          strokeWidth={2.5}
          opacity={0.85}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* 2 — the scrim. Everything before this line is decoration; everything
          after it is meant to be read.

          Two of them, stacked. The base wash is what the idle screen needs; the
          deeper one fades in on top of it while a round is running, when the
          trace has stopped being the thing the player is deciding about and
          started being scenery behind a countdown. Which of the two shows is
          not this component's call — see `.arcade-scrim-deep`, which reads a
          `data-round` set on the frame. */}
      <div
        className="arcade-scrim absolute inset-0"
        data-testid="chart-scrim"
      />
      <div
        className="arcade-scrim-deep absolute inset-0"
        data-testid="chart-scrim-deep"
      />

      {/*
        3 — the guides, across the full height of the frame.

        They do run under the controls row while it is on screen, and that is
        accepted rather than overlooked: a grey hairline and a 10px price behind
        a card with its own surface is a texture, not a collision. The mark that
        genuinely could not share a pixel with a button — the amber entry line —
        only exists while a round is live, which is exactly when that row has
        left the screen.
      */}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        data-testid="tick-chart-guides"
      >
        {/*
          The grid: the paper, not a mark on it. The palette's quietest grey,
          short dashes, thin.

          The dash is 4-on-5-off rather than the 3-on-7-off it started at. That
          is the cheapest way to make a hairline more present without making it
          louder: duty cycle changes how continuous the rule *reads* while
          leaving its colour and weight — the two things that would put it in
          competition with the entry line — exactly where they were.

          Compare with the entry line below: amber, a third again as thick, long
          dashes, drawn last. Four properties apart, so the two can never be
          mistaken for one another however bright the grid gets.
        */}
        {geometry.levels.map((level) => (
          <line
            key={level.price}
            data-testid="price-rule"
            x1={0}
            x2={VIEW_W}
            y1={level.y}
            y2={level.y}
            stroke="currentColor"
            strokeWidth={1.25}
            strokeDasharray="4 5"
            vectorEffect="non-scaling-stroke"
            className="text-[var(--arcade-quiet)]"
          />
        ))}

        {geometry.targetX !== null && (
          <line
            data-testid="target-marker"
            x1={geometry.targetX}
            x2={geometry.targetX}
            y1={0}
            y2={VIEW_H}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="4 6"
            vectorEffect="non-scaling-stroke"
            className="text-[var(--arcade-quiet)]"
          />
        )}

        {/*
          The price to beat, and the loudest thing on the chart.

          Drawn last so it crosses over everything, and given every lever the
          grid was denied: the accent colour instead of grey, 2px instead of 1,
          long dashes instead of specks. Deliberate over-specification — this is
          the one mark here that answers a question rather than providing
          context, and the player has a point riding on which side of it the
          trace ends up.

          Its position is guaranteed, not hoped for: `computeGeometry` pushes
          `entryPrice` into the domain before it computes the scale, so however
          far the market runs the line stays inside the frame and the trace
          rescales around it.
        */}
        {geometry.entryY !== null && (
          <line
            data-testid="entry-line"
            x1={0}
            x2={VIEW_W}
            y1={geometry.entryY}
            y2={geometry.entryY}
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="10 6"
            vectorEffect="non-scaling-stroke"
            className="text-[var(--arcade-amber)]"
          />
        )}
      </svg>

      {/*
        The labels are HTML, not SVG: `preserveAspectRatio="none"` stretches the
        trace to the frame, and it would stretch any text drawn beside it just
        as happily.

        The grid's numbers go right, the entry's word goes left. The board's own
        content is a 420px column down the middle, so neither set can ever meet
        it — and pinning them to opposite edges means they cannot queue up with
        each other either, whatever the scale does.
      */}
      {geometry.levels.map((level) => (
        <span
          key={level.price}
          // Same break in the rule as the entry tag, for the same reason —
          // these numbers are centred on the line they name. Quieter about it:
          // a grey hairline through a grey figure costs less than an amber
          // dash through an amber word, so the tag has no radius to speak of
          // and only enough padding to clear the dashes either side.
          className="pointer-events-none absolute right-4 -translate-y-1/2 rounded-[3px] bg-[var(--arcade-ink)] px-1 font-mono text-[10px] tabular-nums text-[var(--arcade-dim)] sm:right-6"
          style={{ top: `${level.topPct}%` }}
          data-testid="price-level"
        >
          {/* No symbol and no cents: these are round numbers by construction,
              the currency is stated three times over on the rest of the screen,
              and "$64,750.00" at 10px is mostly punctuation. */}
          {grid.format(level.price)}
        </span>
      ))}

      {/*
        The word, and not the number.

        The entry price is already set in the entry card in the middle of the
        frame, so printing it again here would be the same figure twice on one
        screen. But an unexplained amber rule across a chart is a puzzle, and
        the grid it must be told apart from is labelled — so the line gets the
        noun and the card keeps the number.
      */}
      {geometry.entryTopPct !== null && (
        <span
          // The plate is the whole point of this element's styling. The label
          // is centred on the line by construction — that is what makes it a
          // label for *that* line and not the one above — so without a ground
          // of its own the dashes run through the letterforms, and a 10px word
          // tracked out to 0.18em is mostly gaps for them to run through. An
          // opaque ink tag reads as a break in the rule, which is what a chart
          // annotation is supposed to look like anyway.
          className="pointer-events-none absolute left-4 -translate-y-1/2 rounded-[4px] bg-[var(--arcade-ink)] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.18em] text-[var(--arcade-amber)] uppercase sm:left-6"
          style={{ top: `${geometry.entryTopPct}%` }}
          data-testid="entry-label"
        >
          Entry
        </span>
      )}
    </div>
  );
}

/**
 * The chart as a chart: a bounded box with the trace as the loudest thing in
 * it, price levels as hairlines and the entry price called out in a chip.
 *
 * No scrim, because nothing is written on top of it.
 */
function Panel({
  geometry,
  entryPrice,
  className,
}: {
  geometry: ChartGeometry;
  entryPrice?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("relative size-full", className)}
      aria-hidden="true"
      data-testid="tick-chart"
      data-variant="panel"
    >
      {/* Levels first, so the trace draws over them. */}
      {geometry.levels.map((level) => (
        <div
          key={level.price}
          className="pointer-events-none absolute inset-x-0 flex items-center"
          style={{ top: `${level.topPct}%` }}
          data-testid="price-level"
        >
          <span className="h-px flex-1 bg-border" />
          <span className="pr-2 pl-1 text-[10px] tabular-nums text-muted-foreground/70">
            {usd.format(level.price)}
          </span>
        </div>
      ))}

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full text-amber-300/80"
        data-testid="tick-chart-trace"
      >
        <defs>
          <linearGradient
            id="tick-chart-fade-panel"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={geometry.area} fill="url(#tick-chart-fade-panel)" />

        <polyline
          points={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {geometry.entryY !== null && (
          <line
            data-testid="entry-line"
            x1={0}
            x2={VIEW_W}
            y1={geometry.entryY}
            y2={geometry.entryY}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
            className="text-amber-200/70"
          />
        )}

        {geometry.targetX !== null && (
          <line
            data-testid="target-marker"
            x1={geometry.targetX}
            x2={geometry.targetX}
            y1={0}
            y2={VIEW_H}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="4 6"
            vectorEffect="non-scaling-stroke"
            className="text-muted-foreground/60"
          />
        )}
      </svg>

      {/* The one level the player actually cares about, labelled. */}
      {geometry.entryTopPct !== null && entryPrice !== undefined && (
        <span
          className="pointer-events-none absolute right-2 -translate-y-1/2 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-200 ring-1 ring-amber-300/30"
          style={{ top: `${geometry.entryTopPct}%` }}
          data-testid="entry-label"
        >
          {usd.format(entryPrice)}
        </span>
      )}
    </div>
  );
}
