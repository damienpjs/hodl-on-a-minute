"use client";

import { Loader2 } from "lucide-react";

import { GameBoard } from "@/components/game/game-board";
import { Button } from "@/components/ui/button";
import { useGame, useNow } from "@/hooks/use-game";
import { useLivePrice } from "@/hooks/use-live-price";

/**
 * Wires the board to its data. Everything visual lives in `GameBoard`, which
 * takes plain props — this file exists only to fetch, tick and hand over.
 */
export function Game() {
  const { state, guess } = useGame();
  const { price, status, ticks } = useLivePrice();
  const now = useNow();

  // The board fills the viewport, so these two do too — otherwise the app is a
  // line of grey text in the top-left corner of a black page for as long as the
  // first request takes.
  if (state.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading your game…
      </div>
    );
  }

  if (state.isError || !state.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-rose-300" role="alert">
          {state.error instanceof Error
            ? state.error.message
            : "Could not load the game"}
        </p>
        <Button variant="outline" onClick={() => void state.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <GameBoard
      state={state.data}
      price={price}
      priceStatus={status}
      ticks={ticks}
      now={now}
      onGuess={(direction) => guess.mutate(direction)}
      // `variables` is the direction handed to the last `mutate`, so the board
      // can light up the clicked button on the click itself rather than a
      // round-trip later. Read only while the mutation is actually in flight.
      placing={guess.isPending ? (guess.variables ?? null) : null}
      actionError={guess.isError ? describeGuessError(guess.error) : null}
    />
  );
}

function describeGuessError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Could not place the guess";
}
