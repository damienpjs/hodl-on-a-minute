import type { PriceStatus } from "@/hooks/use-live-price";
import { cn } from "@/lib/utils";

/**
 * The price-feed indicator: a coloured dot, the pair, and a word.
 *
 * The dot is green *and* pulsing only on `live`. Anything less — a fallback
 * poll, a dead feed — gets amber or red, because a green light on a degraded
 * feed teaches the player to distrust the whole display.
 *
 * The dot carries no information the label does not already state, so it is
 * hidden from assistive technology rather than announced twice.
 *
 * No longer a `Badge`. The arcade header has one pill in it — the streak — and
 * a second pill next to it would read as a second control rather than as a
 * status light. Stripped to a dot and a line of small caps, it reads as
 * instrumentation, which is what it is.
 */

const PRESENTATION: Record<
  PriceStatus,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  live: {
    label: "live",
    dot: "bg-[var(--arcade-up)]",
    text: "text-[var(--arcade-up)]",
    pulse: true,
  },
  degraded: {
    label: "server fallback",
    dot: "bg-[var(--arcade-amber)]",
    text: "text-[var(--arcade-amber)]",
    pulse: false,
  },
  connecting: {
    label: "connecting",
    dot: "bg-[var(--arcade-amber)]",
    text: "text-[var(--arcade-amber)]",
    pulse: false,
  },
  offline: {
    label: "no price feed",
    dot: "bg-[var(--arcade-down)]",
    text: "text-[var(--arcade-down)]",
    pulse: false,
  },
};

export function PriceStatusBadge({ status }: { status: PriceStatus }) {
  const { label, dot, text, pulse } = PRESENTATION[status];

  return (
    <span
      className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.12em] uppercase sm:text-[11px]"
      data-testid="price-status"
      data-status={status}
    >
      <span className="relative flex size-1.5" aria-hidden="true">
        {pulse && (
          // `motion-safe` so a reduced-motion preference gets a steady dot
          // rather than none at all.
          <span
            data-testid="price-status-pulse"
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-75",
              "motion-safe:animate-ping",
              dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex size-1.5 rounded-full", dot)} />
      </span>
      <span className="text-[var(--arcade-dim)]">BTC/USD</span>
      {/* Its own element, holding exactly the label: the status word is the one
          string worth asserting on, and burying it in a sentence would make
          every test of it a substring match. */}
      <span className={text}>{label}</span>
    </span>
  );
}
