import { ArrowDown, ArrowUp, Bitcoin, Loader2 } from "lucide-react";

import { GuessHistory } from "@/components/game/guess-history";
import { PriceStatusBadge } from "@/components/game/price-status";
import { TickChart } from "@/components/game/tick-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PriceStatus, PriceTick } from "@/hooks/use-live-price";
import { RESOLUTION_DELAY_MS } from "@/lib/game";
import type { GameState } from "@/lib/api/game-state";
import type { Direction, LastResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The whole interface, as a pure function of its props.
 *
 * No data fetching and no clock of its own: `now` arrives as a number, so every
 * state the player can be in — counting down, waiting for a move, just won, just
 * lost — is reachable in a test by passing different props.
 *
 * Two columns on a wide screen: the market and the act of playing on the left,
 * the record of past guesses on the right. On a narrow one they stack, market
 * first, so the price and the buttons stay together.
 */

export type GameBoardProps = {
  state: GameState;
  price: number | null;
  priceStatus: PriceStatus;
  ticks: PriceTick[];
  now: number;
  onGuess: (direction: Direction) => void;
  /** The direction being submitted right now, or `null` when nothing is in flight. */
  placing: Direction | null;
  actionError: string | null;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * Pastel rather than saturated, and only ever the current state of the market —
 * never a flash on every tick. The tension should come from the game, not from
 * the interface shouting.
 */
function priceTone(price: number | null, entryPrice: number): string {
  if (price === null || price === entryPrice) return "";
  return price > entryPrice ? "text-emerald-300" : "text-rose-300";
}

/**
 * The mark identifies the *asset*, so it belongs to the market card and not to
 * the page title — next to the app name it would read as the game's own logo.
 */
function BitcoinMark() {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300 ring-1 ring-amber-300/25"
      data-testid="bitcoin-mark"
    >
      <Bitcoin className="size-4" aria-hidden="true" />
    </span>
  );
}

export function GameBoard({
  state,
  price,
  priceStatus,
  ticks,
  now,
  onGuess,
  placing,
  actionError,
}: GameBoardProps) {
  const guess = state.activeGuess;
  const isLocked = Boolean(guess) || placing !== null;

  // The direction the player is committed to, from the instant they click:
  // `placing` covers the round-trip, `guess.direction` everything after it. The
  // buttons key their colour off this, so the choice is never briefly forgotten.
  const chosen = guess?.direction ?? placing;

  // Client clock against a server timestamp. Good enough for a countdown; the
  // resolution decision itself is made server-side and never trusts this.
  const remainingMs = guess
    ? Math.max(0, guess.entryAt + RESOLUTION_DELAY_MS - now)
    : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const remainingFraction = remainingMs / RESOLUTION_DELAY_MS;

  return (
    <div className="w-full max-w-5xl space-y-10">
      {/*
        Centred on the page, and the app's identity alone: a title, a tagline and
        the room a logo will take. The Bitcoin mark lives on the market card
        below, next to the pair it actually names.
      */}
      <header className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">HODL On A Minute</h1>
        <p className="text-sm text-muted-foreground">
          A 60-second BTC prediction game
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card className="[--card-spacing:--spacing(6)]">
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <BitcoinMark />
                  <span className="text-sm font-medium">BTC / USD</span>
                </div>
                <PriceStatusBadge status={priceStatus} />
              </div>

              {guess ? (
                // Once a guess is live, the only number that matters is the one
                // it has to beat — so the two are shown side by side.
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Price to beat
                    </p>
                    <p
                      className="text-2xl font-semibold tabular-nums"
                      data-testid="price-to-beat"
                    >
                      {usd.format(guess.entryPrice)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Current
                    </p>
                    <p
                      className={cn(
                        "text-2xl font-semibold tabular-nums",
                        priceTone(price, guess.entryPrice),
                      )}
                      aria-live="polite"
                      data-testid="current-price"
                    >
                      {price === null ? "—" : usd.format(price)}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Current
                  </p>
                  <p
                    className="text-4xl font-semibold tabular-nums"
                    aria-live="polite"
                    data-testid="current-price"
                  >
                    {price === null ? "—" : usd.format(price)}
                  </p>
                </div>
              )}

              {/* Bleeds to the card edges. The card clips it, so the trace reads
                  as the surface the numbers sit on, not as a separate widget. */}
              <div className="-mx-6 -mb-6 h-48">
                <TickChart
                  ticks={ticks}
                  entryPrice={guess?.entryPrice}
                  entryAt={guess?.entryAt}
                  now={now}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="[--card-spacing:--spacing(6)]">
            <CardContent className="space-y-5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Score
                </span>
                <span
                  className="text-3xl font-semibold tabular-nums"
                  data-testid="score"
                >
                  {state.score > 0 ? `+${state.score}` : state.score}
                </span>
              </div>

              <div className="border-t pt-5">
                {guess ? (
                  <PendingPanel
                    direction={guess.direction}
                    entryPrice={guess.entryPrice}
                    remainingSeconds={remainingSeconds}
                    priceUnavailable={state.priceUnavailable === true}
                  />
                ) : (
                  <LastOutcome result={state.history[0]} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DirectionButton
                  direction="up"
                  chosen={chosen}
                  locked={isLocked}
                  isPlacing={placing === "up"}
                  remainingFraction={remainingFraction}
                  onClick={onGuess}
                />
                <DirectionButton
                  direction="down"
                  chosen={chosen}
                  locked={isLocked}
                  isPlacing={placing === "down"}
                  remainingFraction={remainingFraction}
                  onClick={onGuess}
                />
              </div>

              {isLocked && (
                <p className="text-center text-sm text-muted-foreground" role="status">
                  {placing
                    ? "Placing your guess…"
                    : "One guess at a time — wait for this one to resolve."}
                </p>
              )}

              {actionError && (
                <p className="text-center text-sm text-rose-300" role="alert">
                  {actionError}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Not sticky: "Show all" can make this list taller than the viewport,
            and a stuck element that tall hides its own bottom rows. */}
        <aside>
          <Card className="[--card-spacing:--spacing(6)]">
            <CardContent>
              <GuessHistory results={state.history} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/**
 * The two colours are the app's whole vocabulary — green is up, red is down —
 * so the surest way to keep the player's choice in front of them is to leave
 * their colour switched on and switch the other one off.
 *
 * Three states, and only three:
 *
 * - `idle`    — both playable, tinted, hoverable.
 * - `chosen`  — locked in. Full colour at full opacity, ringed, and the fill
 *               drains left-to-right as the minute runs out.
 * - `dimmed`  — the road not taken. Stripped of colour and faded, so it reads
 *               as unavailable rather than as a second live option.
 *
 * `ghost` rather than `outline`: the outline variant carries its own
 * `dark:bg-*`, which — being a compound selector — outranks a plain `bg-*` on
 * specificity and would quietly win over the tint on this dark-only theme.
 */
const DIRECTION_TONE = {
  up: {
    idle: "border-emerald-300/25 bg-emerald-400/12 text-emerald-200 hover:bg-emerald-400/20 dark:hover:bg-emerald-400/20 hover:text-emerald-100",
    chosen:
      "border-emerald-300/55 bg-emerald-400/18 text-emerald-100 ring-1 ring-emerald-300/25",
    drain: "bg-emerald-400/30",
  },
  down: {
    idle: "border-rose-300/25 bg-rose-400/12 text-rose-200 hover:bg-rose-400/20 dark:hover:bg-rose-400/20 hover:text-rose-100",
    chosen: "border-rose-300/55 bg-rose-400/18 text-rose-100 ring-1 ring-rose-300/25",
    drain: "bg-rose-400/30",
  },
} as const;

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown } as const;

function DirectionButton({
  direction,
  chosen,
  locked,
  isPlacing,
  remainingFraction,
  onClick,
}: {
  direction: Direction;
  chosen: Direction | null;
  locked: boolean;
  isPlacing: boolean;
  remainingFraction: number;
  onClick: (direction: Direction) => void;
}) {
  const tone = DIRECTION_TONE[direction];
  const Icon = DIRECTION_ICON[direction];

  const state = !locked ? "idle" : chosen === direction ? "chosen" : "dimmed";
  const remaining = Math.min(1, Math.max(0, remainingFraction));

  return (
    <Button
      size="lg"
      variant="ghost"
      className={cn(
        "relative h-14 overflow-hidden text-base",
        state === "idle" && tone.idle,
        // `disabled:opacity-100` undoes the button's own fade: this one is
        // disabled but it is not the greyed-out one, it is the answer.
        state === "chosen" && cn(tone.chosen, "disabled:opacity-100"),
        state === "dimmed" && "border-border text-muted-foreground disabled:opacity-40",
      )}
      disabled={locked}
      onClick={() => onClick(direction)}
      data-testid={`direction-${direction}`}
      data-state={state}
    >
      {/*
        A time bar rather than a second countdown: the seconds are already
        written above in full size, and this only has to answer "how much
        longer" at a glance. It empties to nothing at the 60-second mark, which
        is also the moment the copy above stops counting.
      */}
      {state === "chosen" && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 transition-[width] duration-200 ease-linear motion-reduce:transition-none",
            tone.drain,
          )}
          style={{ width: `${remaining * 100}%` }}
          data-testid={`direction-${direction}-drain`}
        />
      )}

      <span className="relative flex items-center gap-2">
        {isPlacing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Icon className="size-4" />
        )}
        {direction === "up" ? "Up" : "Down"}
      </span>
    </Button>
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
    <div className="space-y-2 text-center">
      <p className="text-sm text-muted-foreground">
        You guessed <span className="font-medium text-foreground">{direction}</span> from{" "}
        {usd.format(entryPrice)}
      </p>

      {/*
        A counter frozen at 0:00 looks broken. Past the 60-second mark the app is
        genuinely waiting on something else — the price moving — so it says so
        instead of pretending to count.
      */}
      {remainingSeconds > 0 ? (
        <p className="text-4xl font-semibold tabular-nums">{remainingSeconds}s</p>
      ) : (
        <p className="text-base font-medium" data-testid="waiting-for-move">
          Waiting for the price to move…
        </p>
      )}

      {priceUnavailable && (
        <p className="text-sm text-rose-300" role="alert">
          Price feed unreachable — your guess stays open until we can read a price.
        </p>
      )}
    </div>
  );
}

/**
 * The headline only. The prices behind it live in the history list, so repeating
 * them here would say the same thing twice on one screen.
 */
function LastOutcome({ result }: { result?: LastResult }) {
  if (!result) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Pick a direction. In 60 seconds, once the price has moved, you win or lose a
        point.
      </p>
    );
  }

  const won = result.delta === 1;

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">
        {won ? "You were right" : "You were wrong"}
      </span>
      <Badge
        variant="outline"
        className={cn(
          won
            ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-300"
            : "border-rose-300/30 bg-rose-400/15 text-rose-300",
        )}
        data-testid="result-delta"
      >
        {won ? "+1" : "−1"}
      </Badge>
    </div>
  );
}
