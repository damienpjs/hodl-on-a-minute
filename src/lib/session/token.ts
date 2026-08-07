import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing and verification for the player-identity cookie.
 *
 * Kept pure and free of any Next.js import so it can be tested directly. The
 * cookie plumbing lives next door in `index.ts`.
 *
 * The identity determines the score, which is why it is signed rather than
 * merely stored: `localStorage` — or an unsigned cookie — would let anyone claim
 * any player's score by editing one value.
 */

export const COOKIE_NAME = "hodl_player";

/** One year, per the assignment's "close the browser and come back" requirement. */
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const SEPARATOR = ".";

function sign(playerId: string, secret: string): string {
  return createHmac("sha256", secret).update(playerId).digest("base64url");
}

/** Serialises `<playerId>.<hmac>` for storage in the cookie. */
export function createSignedToken(playerId: string, secret: string): string {
  return `${playerId}${SEPARATOR}${sign(playerId, secret)}`;
}

/**
 * Returns the player id only if the signature verifies.
 *
 * A tampered, truncated or unsigned value yields `null`, and the caller then
 * issues a *new* player — never the claimed one. Failing open to the claimed id
 * would defeat the entire purpose of signing.
 */
export function readSignedToken(
  token: string | undefined,
  secret: string,
): string | null {
  if (!token) return null;

  const separatorIndex = token.lastIndexOf(SEPARATOR);
  if (separatorIndex <= 0) return null;

  const playerId = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);
  if (!providedSignature) return null;

  const expected = Buffer.from(sign(playerId, secret));
  const provided = Buffer.from(providedSignature);

  // timingSafeEqual throws on a length mismatch, so compare lengths first. The
  // length of an HMAC is not a secret, so the early return leaks nothing useful.
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  return playerId;
}
