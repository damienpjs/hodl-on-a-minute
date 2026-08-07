import { Badge } from "@/components/ui/badge";
import type { PriceStatus } from "@/hooks/use-live-price";
import { cn } from "@/lib/utils";

/**
 * The price-feed indicator: a coloured dot and a word.
 *
 * The dot is green *and* pulsing only on `live`. Anything less — a fallback
 * poll, a dead feed — gets amber or red, because a green light on a degraded
 * feed teaches the player to distrust the whole display.
 *
 * The dot carries no information the label does not already state, so it is
 * hidden from assistive technology rather than announced twice.
 */

const PRESENTATION: Record<
  PriceStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  live: { label: "live", dot: "bg-emerald-300", pulse: true },
  degraded: { label: "server fallback", dot: "bg-amber-300", pulse: false },
  connecting: { label: "connecting", dot: "bg-amber-300", pulse: false },
  offline: { label: "no price feed", dot: "bg-rose-300", pulse: false },
};

export function PriceStatusBadge({ status }: { status: PriceStatus }) {
  const { label, dot, pulse } = PRESENTATION[status];

  return (
    <Badge
      variant="outline"
      className="gap-1.5"
      data-testid="price-status"
      data-status={status}
    >
      <span className="relative flex size-2" aria-hidden="true">
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
        <span className={cn("relative inline-flex size-2 rounded-full", dot)} />
      </span>
      {label}
    </Badge>
  );
}
