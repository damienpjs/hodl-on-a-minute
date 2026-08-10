import { toGameState } from "@/lib/api/game-state";
import { serviceUnavailable } from "@/lib/api/responses";
import { DataStoreUnavailableError, getOrCreatePlayer } from "@/lib/db";
import { getSession, setSessionCookie } from "@/lib/session";

/**
 * GET /api/session — who the caller is, and where their game stands.
 *
 * The identity comes from the signed cookie and nowhere else: no query string,
 * no header, no body. A first-time caller is minted a player id server-side and
 * gets the cookie set on the way out.
 *
 * This is the read that never resolves anything, as opposed to GET /api/guess.
 * A client that wants the state without triggering a resolution asks here.
 */
export async function GET() {
  try {
    const { playerId, isNew } = await getSession();

    const player = await getOrCreatePlayer(playerId);
    if (isNew) await setSessionCookie(playerId);

    return Response.json(toGameState(player));
  } catch (error) {
    if (error instanceof DataStoreUnavailableError) {
      return serviceUnavailable("Cannot reach the data store — try again shortly");
    }
    throw error;
  }
}
