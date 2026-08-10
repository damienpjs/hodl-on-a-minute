/**
 * 503, not 500.
 *
 * The distinction is the whole point: 500 says "we have a bug", 503 says "the
 * request was fine, a dependency was not, come back in a moment". The player
 * gets an actionable message instead of a dead end, and we do not get paged for
 * someone else's outage.
 */
export function serviceUnavailable(message: string): Response {
  return Response.json(
    { error: message },
    { status: 503, headers: { "Retry-After": "5" } },
  );
}
