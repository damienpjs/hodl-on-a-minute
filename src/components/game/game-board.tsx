import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";

import { PriceStatusBadge } from "@/components/game/price-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PriceStatus } from "@/hooks/use-live-price";
import { RESOLUTION_DELAY_MS } from "@/lib/game";
import type { GameState } from "@/lib/api/game-state";
import type { Direction } from "@/lib/types";

/**
 * The whole interface, as a pure function of its props.
 *
 * No data fetching and no clock of its own: `now` arrives as a number, so every
 * state the player can be in — counting down, waiting for a move, just won, just
 * lost — is reachable in a test by passing different props.
 */

export type GameBoardProps = {
  state: GameState;
  price: number | null;
  priceStatus: PriceStatus;
  now: number;
  onGuess: (direction: Direction) => void;
  isPlacing: boolean;
  actionError: string | null;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function GameBoard({
  state,
  price,
  priceStatus,
  now,
  onGuess,
  isPlacing,
  actionError,
}: GameBoardProps) {
  const guess = state.activeGuess;
  const isLocked = Boolean(guess) || isPlacing;

  // Client clock against a server timestamp. Good enough for a countdown; the
  // resolution decision itself is made server-side and never trusts this.
  const remainingMs = guess
    ? Math.max(0, guess.entryAt + RESOLUTION_DELAY_MS - now)
    : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="w-full max-w-md space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">HODL On A Minute</h1>
        <p className="text-sm text-muted-foreground">
          A 60-second BTC prediction game
        </p>
      </header>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">BTC / USD</span>
            <PriceStatusBadge status={priceStatus} />
          </div>

          <p
            className="text-center font-mono text-5xl font-semibold tabular-nums"
            aria-live="polite"
          >
            {price === null ? "—" : usd.format(price)}
          </p>

          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">Score</span>
            <span
              className="font-mono text-2xl font-semibold tabular-nums"
              data-testid="score"
            >
              {state.score > 0 ? `+${state.score}` : state.score}
            </span>
          </div>
        </CardContent>
      </Card>

      {guess ? (
        <PendingPanel
          direction={guess.direction}
          entryPrice={guess.entryPrice}
          remainingSeconds={remainingSeconds}
          priceUnavailable={state.priceUnavailable === true}
        />
      ) : (
        <LastResultPanel state={state} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button
          size="lg"
          className="h-14 text-base"
          disabled={isLocked}
          onClick={() => onGuess("up")}
        >
          {isPlacing ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          Up
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-14 text-base"
          disabled={isLocked}
          onClick={() => onGuess("down")}
        >
          {isPlacing ? <Loader2 className="animate-spin" /> : <ArrowDown />}
          Down
        </Button>
      </div>

      {isLocked && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {isPlacing
            ? "Placing your guess…"
            : "One guess at a time — wait for this one to resolve."}
        </p>
      )}

      {actionError && (
        <p className="text-center text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}

function PendingPanel({
  direction,
  entryPrice,
  remainingSeconds,
  priceUnavailable,
}: {
  direction: Direction;
  entryPrice: number;
  remainingSeconds: number;
  priceUnavailable: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6 text-center">
        <p className="text-sm text-muted-foreground">
          You guessed <span className="font-medium text-foreground">{direction}</span>{" "}
          from {usd.format(entryPrice)}
        </p>

        {/*
          A counter frozen at 0:00 looks broken. Past the 60-second mark the app
          is genuinely waiting on something else — the price moving — so it says
          so instead of pretending to count.
        */}
        {remainingSeconds > 0 ? (
          <p className="font-mono text-4xl font-semibold tabular-nums">
            {remainingSeconds}s
          </p>
        ) : (
          <p className="text-base font-medium" data-testid="waiting-for-move">
            Waiting for the price to move…
          </p>
        )}

        {priceUnavailable && (
          <p className="text-sm text-destructive" role="alert">
            Price feed unreachable — your guess stays open until we can read a
            price.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LastResultPanel({ state }: { state: GameState }) {
  const result = state.lastResult;

  if (!result) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          Pick a direction. In 60 seconds, once the price has moved, you win or
          lose a point.
        </CardContent>
      </Card>
    );
  }

  const won = result.delta === 1;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <span className="font-medium">{won ? "You were right" : "You were wrong"}</span>
          <Badge variant={won ? "default" : "destructive"} data-testid="result-delta">
            {won ? "+1" : "−1"}
          </Badge>
        </div>

        <dl className="space-y-1 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <dt>Your guess</dt>
            <dd className="font-medium text-foreground">{result.direction}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Entry price</dt>
            <dd className="font-mono tabular-nums">{usd.format(result.entryPrice)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Resolved at</dt>
            <dd className="font-mono tabular-nums">
              {usd.format(result.resolvedPrice)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
