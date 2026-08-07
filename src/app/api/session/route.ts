import { toGameState } from "@/lib/api/game-state";
import { getOrCreatePlayer } from "@/lib/db";
import { getSession, setSessionCookie } from "@/lib/session";

/**
 * GET /api/session — who the caller is, and where their game stands.
 *
 * The identity comes from the signed cookie and nowhere else: no query string,
 * no header, no body. A first-time caller is minted a player id server-side and
 * gets the cookie set on the way out.
 */
export async function GET() {
  const { playerId, isNew } = await getSession();

  const player = await getOrCreatePlayer(playerId);
  if (isNew) await setSessionCookie(playerId);

  return Response.json(toGameState(player));
}
