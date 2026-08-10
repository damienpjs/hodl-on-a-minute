"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { GameState } from "@/lib/api/game-state";
import { fetchGameState, placeGuess } from "@/lib/client/api";
import type { Direction } from "@/lib/types";

export const GAME_QUERY_KEY = ["game"] as const;

/** Only while a guess is in flight — an idle player generates no traffic at all. */
const ACTIVE_POLL_INTERVAL_MS = 2_000;

/**
 * The game state, and the one action that changes it.
 *
 * `GET /api/guess` is both the read and the resolver: resolution is lazy, so the
 * act of asking for the state is what settles a due guess. That is why polling
 * this endpoint — rather than a separate "resolve" call — is all the client
 * needs to do.
 */
export function useGame() {
  const queryClient = useQueryClient();

  const state = useQuery({
    queryKey: GAME_QUERY_KEY,
    queryFn: ({ signal }) => fetchGameState(signal),
    refetchInterval: (query) =>
      query.state.data?.activeGuess ? ACTIVE_POLL_INTERVAL_MS : false,
  });

  const guess = useMutation({
    mutationFn: (direction: Direction) => placeGuess(direction),
    onSuccess: (next: GameState) => {
      queryClient.setQueryData(GAME_QUERY_KEY, next);
    },
    onError: () => {
      // A 409 means another tab got there first. Re-read rather than guess at
      // what the truth now is.
      void queryClient.invalidateQueries({ queryKey: GAME_QUERY_KEY });
    },
  });

  return { state, guess };
}

/**
 * A clock that ticks, for the countdown.
 *
 * Returned rather than read inside the view so the board stays a pure function
 * of its props and can be tested at any instant without fake timers.
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
