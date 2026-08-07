"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { LastResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The player's recent guesses, newest first.
 *
 * Expanding is local state rather than a prop, which keeps `GameBoard` a pure
 * function of its data. "Show all" means all the rows the server sent — the
 * store keeps a bounded window, and the README says where that bound is.
 */

export const DEFAULT_HISTORY_LIMIT = 5;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

export type GuessHistoryProps = {
  results: LastResult[];
  limit?: number;
};

export function GuessHistory({
  results,
  limit = DEFAULT_HISTORY_LIMIT,
}: GuessHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  const canExpand = results.length > limit;
  const visible = expanded ? results : results.slice(0, limit);

  return (
    <section aria-labelledby="history-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="history-heading"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          History
        </h2>
        {canExpand && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setExpanded((open) => !open)}
            data-testid="toggle-history"
          >
            {expanded ? "Show less" : `Show all (${results.length})`}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground" data-testid="history-empty">
          No guesses yet.
        </p>
      ) : (
        <ul className="divide-y divide-border" data-testid="history-list">
          {visible.map((result) => (
            <HistoryRow key={result.resolvedAt} result={result} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({ result }: { result: LastResult }) {
  const won = result.delta === 1;
  const wentUp = result.direction === "up";

  // Two lines rather than one: in the sidebar the column is 340px wide, and a
  // single row would truncate the pair of prices — the one thing worth reading.
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm" data-testid="history-row">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          wentUp
            ? "bg-emerald-400/12 text-emerald-300"
            : "bg-rose-400/12 text-rose-300",
        )}
      >
        {wentUp ? (
          <ArrowUp className="size-3.5" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-3.5" aria-hidden="true" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium capitalize">{result.direction}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
            {time.format(result.resolvedAt)}
          </span>
        </div>
        <p className="truncate tabular-nums text-muted-foreground">
          {usd.format(result.entryPrice)} → {usd.format(result.resolvedPrice)}
        </p>
      </div>

      <span
        className={cn(
          "w-8 shrink-0 text-right font-semibold tabular-nums",
          won ? "text-emerald-300" : "text-rose-300",
        )}
        data-testid="history-delta"
      >
        {won ? "+1" : "−1"}
      </span>
      <span className="sr-only">{won ? "won" : "lost"}</span>
    </li>
  );
}
