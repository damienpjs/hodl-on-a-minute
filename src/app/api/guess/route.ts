import { randomUUID } from "node:crypto";
import { z } from "zod";

import { type GameState, toGameState } from "@/lib/api/game-state";
import { serviceUnavailable } from "@/lib/api/responses";
import {
  createGuess,
  DataStoreUnavailableError,
  getOrCreatePlayer,
  getPlayer,
  GuessAlreadyActiveError,
  GuessAlreadyResolvedError,
  resolveGuess,
} from "@/lib/db";
import { resolveOutcome } from "@/lib/game";
import {
  binancePriceSource,
  getCurrentPrice,
  PriceUnavailableError,
} from "@/lib/price";
import { getSession, setSessionCookie } from "@/lib/session";
import type { ActiveGuess, PlayerItem } from "@/lib/types";

/**
 * The direction, and nothing else.
 *
 * Zod strips unknown keys by default, and that default is load-bearing here: a
 * client that posts `{ direction: "up", price: 1, entryAt: 0 }` has those two
 * extra fields dropped before this handler can see them, and the guess is priced
 * from Binance server-side regardless. A `price` or `entryAt` field in this
 * schema would be a design bug — see `fairness-invariants`, I1.
 */
const guessRequestSchema = z.object({
  direction: z.enum(["up", "down"]),
});

/** Identity first, on every request, from the cookie alone. */
async function resolveCaller(): Promise<PlayerItem> {
  const { playerId, isNew } = await getSession();
  const player = await getOrCreatePlayer(playerId);
  if (isNew) await setSessionCookie(playerId);
  return player;
}

/**
 * POST /api/guess — place a guess.
 *
 * Entry price and entry time are both produced here, on the server, after the
 * request has been parsed. That ordering is the whole fairness story: there is
 * no moment at which a client-supplied value could reach them.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = guessRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Body must be { "direction": "up" | "down" }' },
      { status: 400 },
    );
  }

  try {
    const player = await resolveCaller();

    // Both produced here, on the server, after the body has been parsed. There
    // is no moment at which a client-supplied value could reach them.
    const guess: ActiveGuess = {
      id: randomUUID(),
      direction: parsed.data.direction,
      entryPrice: await getCurrentPrice(),
      entryAt: Date.now(),
    };

    const updated = await createGuess(player.playerId, guess);
    return Response.json(toGameState(updated), { status: 201 });
  } catch (error) {
    // Not a failure so much as a lost race — the double-click case. The
    // condition lives in DynamoDB, so this is the only place it can surface.
    if (error instanceof GuessAlreadyActiveError) {
      return Response.json(
        { error: "A guess is already in flight" },
        { status: 409 },
      );
    }
    if (error instanceof PriceUnavailableError) {
      return serviceUnavailable("Cannot price a guess right now — try again shortly");
    }
    if (error instanceof DataStoreUnavailableError) {
      return serviceUnavailable("Cannot reach the data store — try again shortly");
    }
    throw error;
  }
}

/**
 * GET /api/guess — resolve the active guess if it is due, then return the state.
 *
 * Resolution is lazy, on read. There is no scheduled job: a guess resolves the
 * next time anyone asks about it, which is what lets a player close the browser
 * for three days and still get a fair answer when they come back.
 */
export async function GET() {
  try {
    const player = await resolveCaller();
    const guess = player.activeGuess;

    if (!guess) return Response.json(toGameState(player));

    let outcome;
    try {
      outcome = await resolveOutcome(guess, binancePriceSource, Date.now());
    } catch (error) {
      if (error instanceof PriceUnavailableError) {
        // Stay pending and say so — 200, not 503: the guess is intact and the
        // state is worth reading. Resolving on a price we could not read would
        // be the one unforgivable bug in this app.
        const state: GameState = { ...toGameState(player), priceUnavailable: true };
        return Response.json(state);
      }
      throw error;
    }

    if (outcome.status === "pending") return Response.json(toGameState(player));

    try {
      const updated = await resolveGuess(player.playerId, guess.id, outcome.delta, {
        direction: guess.direction,
        entryPrice: guess.entryPrice,
        resolvedPrice: outcome.resolvedPrice,
        delta: outcome.delta,
        resolvedAt: outcome.resolvedAt,
      });
      return Response.json(toGameState(updated));
    } catch (error) {
      // A concurrent request resolved it first. The work is done and the score
      // already moved exactly once, so re-read and answer 200 rather than
      // erroring.
      if (error instanceof GuessAlreadyResolvedError) {
        const fresh = await getPlayer(player.playerId);
        return Response.json(toGameState(fresh ?? player));
      }
      throw error;
    }
  } catch (error) {
    // Nothing above could be read or written at all. Unlike the price outage,
    // there is no state to return, so the caller is told to come back.
    if (error instanceof DataStoreUnavailableError) {
      return serviceUnavailable("Cannot reach the data store — try again shortly");
    }
    throw error;
  }
}
