import { getCurrentPrice, PriceUnavailableError } from "@/lib/price";

/**
 * GET /api/price — the server's view of the BTC/USD price.
 *
 * The browser also streams the price straight from Binance over a WebSocket for
 * a smooth display. That stream is comfort; this route is the fallback when it
 * is blocked. Neither is ever used to price a guess — that always happens
 * server-side inside POST /api/guess.
 */
export async function GET() {
  try {
    return Response.json({ price: await getCurrentPrice() });
  } catch (error) {
    if (error instanceof PriceUnavailableError) {
      return Response.json(
        { error: "Price temporarily unavailable" },
        { status: 503 },
      );
    }
    throw error;
  }
}
