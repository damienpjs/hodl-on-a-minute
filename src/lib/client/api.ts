import type { GameState } from "@/lib/api/game-state";
import type { Direction } from "@/lib/types";

/**
 * The browser's side of the API. Kept in one file so every request the client is
 * capable of making is visible at a glance — which is also the quickest way to
 * confirm that none of them sends a price, a timestamp or a player id.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);

  if (body && typeof body === "object" && "error" in body) {
    const { error } = body as { error: unknown };
    if (typeof error === "string") return error;
  }
  return fallback;
}

/** Current state, resolving the active guess first if it is due. */
export async function fetchGameState(signal?: AbortSignal): Promise<GameState> {
  const response = await fetch("/api/guess", { signal });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response, "Could not load the game"));
  }
  return (await response.json()) as GameState;
}

/** The server's price, used only when the Binance stream is unavailable. */
export async function fetchServerPrice(signal?: AbortSignal): Promise<number> {
  const response = await fetch("/api/price", { signal });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response, "Price unavailable"));
  }
  const { price } = (await response.json()) as { price: number };
  return price;
}

/**
 * Places a guess.
 *
 * The body is one field. Adding an entry price here would not just be useless —
 * the server strips it — it would misrepresent how the game works to the next
 * person reading this file.
 */
export async function placeGuess(direction: Direction): Promise<GameState> {
  const response = await fetch("/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction }),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readError(response, "Could not place the guess"),
    );
  }
  return (await response.json()) as GameState;
}
