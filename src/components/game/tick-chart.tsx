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

export type TickChartProps = {
  ticks: PriceTick[];
  entryPrice?: number;
  entryAt?: number;
  now: number;
  className?: string;
};

export type PriceLevel = {
  price: number;
  /** Distance from the top of the frame, as a percentage. */
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
 * A step from the 1 / 2 / 5 × 10ⁿ family — the reason chart gridlines land on
 * numbers a human would have chosen, instead of on $64,873.41.
 */
export function niceStep(span: number, targetCount = TARGET_LEVELS): number {
  const raw = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
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
}: Omit<TickChartProps, "className">): ChartGeometry | null {
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
  const targetIsVisible = targetAt !== null && targetAt >= from && targetAt <= now;

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
    levels.push({ price: snapped, topPct: toTopPct(snapped) });
  }

  return {
    line: points.join(" "),
    area: `M ${toX(start.at)},${VIEW_H} L ${points.join(" L ")} L ${toX(last.at)},${VIEW_H} Z`,
    entryY: entryPrice === undefined ? null : toY(entryPrice),
    entryTopPct: entryPrice === undefined ? null : toTopPct(entryPrice),
    targetX: targetIsVisible ? toX(targetAt) : null,
    levels,
  };
}

export function TickChart({ className, ...input }: TickChartProps) {
  const geometry = computeGeometry(input);

  if (!geometry) return null;

  return (
    // Decorative in full, level labels included: the numbers above the chart
    // already announce the current and entry prices, so a screen reader reading
    // out four more would be noise. Nothing in here is interactive.
    <div
      className={cn("relative size-full", className)}
      aria-hidden="true"
      data-testid="tick-chart"
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
          <linearGradient id="tick-chart-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={geometry.area} fill="url(#tick-chart-fade)" />

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
      {geometry.entryTopPct !== null && input.entryPrice !== undefined && (
        <span
          className="pointer-events-none absolute right-2 -translate-y-1/2 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-200 ring-1 ring-amber-300/30"
          style={{ top: `${geometry.entryTopPct}%` }}
          data-testid="entry-label"
        >
          {usd.format(input.entryPrice)}
        </span>
      )}
    </div>
  );
}
