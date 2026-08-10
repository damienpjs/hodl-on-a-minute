import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createSignedToken, readSignedToken } from "@/lib/session/token";

/**
 * Identity determines the score, so the cookie that carries it is the second
 * thing a cheater would reach for after the price — and the only thing standing
 * in the way is this signature.
 *
 * The rule these tests exist to hold: a token that does not verify yields
 * `null`, never the player id it claims. `getSession` then mints a *new* player.
 * Failing open to the claimed id would defeat the entire point of signing.
 */

const SECRET = "test-cookie-secret-at-least-32-characters";
const OTHER_SECRET = "a-completely-different-secret-of-length";
const PLAYER = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("createSignedToken", () => {
  it("emits the player id followed by its signature", () => {
    const token = createSignedToken(PLAYER, SECRET);

    expect(token.startsWith(`${PLAYER}.`)).toBe(true);
    expect(token.slice(PLAYER.length + 1)).not.toHaveLength(0);
  });

  it("is deterministic for the same id and secret", () => {
    expect(createSignedToken(PLAYER, SECRET)).toBe(createSignedToken(PLAYER, SECRET));
  });

  it("produces a different signature under a different secret", () => {
    expect(createSignedToken(PLAYER, SECRET)).not.toBe(
      createSignedToken(PLAYER, OTHER_SECRET),
    );
  });
});

describe("readSignedToken — accepting what it should", () => {
  it("returns the player id for a token it signed itself", () => {
    expect(readSignedToken(createSignedToken(PLAYER, SECRET), SECRET)).toBe(PLAYER);
  });

  it("handles a player id containing the separator", () => {
    // Not a UUID, but the parser splits on the *last* dot for a reason and that
    // reason should stay true.
    const odd = "player.with.dots";
    expect(readSignedToken(createSignedToken(odd, SECRET), SECRET)).toBe(odd);
  });
});

describe("readSignedToken — refusing everything else", () => {
  it("refuses a missing or empty cookie", () => {
    expect(readSignedToken(undefined, SECRET)).toBeNull();
    expect(readSignedToken("", SECRET)).toBeNull();
  });

  it("refuses a value with no signature at all", () => {
    expect(readSignedToken(PLAYER, SECRET)).toBeNull();
    expect(readSignedToken(`${PLAYER}.`, SECRET)).toBeNull();
  });

  it("refuses a signature with no player id", () => {
    expect(readSignedToken(`.${"a".repeat(43)}`, SECRET)).toBeNull();
  });

  /**
   * The attack this all exists to stop: claim someone else's id by editing the
   * cookie. The signature no longer matches the id in front of it.
   */
  it("refuses a claimed id that the signature does not cover", () => {
    const mine = createSignedToken(PLAYER, SECRET);
    const signature = mine.slice(mine.lastIndexOf(".") + 1);
    const victim = "00000000-0000-4000-8000-000000000000";

    expect(readSignedToken(`${victim}.${signature}`, SECRET)).toBeNull();
  });

  it("refuses a signature of the right length but the wrong bytes", () => {
    const token = createSignedToken(PLAYER, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);

    // Flip one character. Length is preserved, so this gets past the length
    // guard and has to be caught by the comparison itself.
    const first = signature[0] === "A" ? "B" : "A";
    const tampered = `${PLAYER}.${first}${signature.slice(1)}`;

    expect(tampered).toHaveLength(token.length);
    expect(readSignedToken(tampered, SECRET)).toBeNull();
  });

  it("refuses a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the guard in front of it is
    // what keeps a truncated cookie from becoming a 500.
    const token = createSignedToken(PLAYER, SECRET);

    expect(() => readSignedToken(token.slice(0, -5), SECRET)).not.toThrow();
    expect(readSignedToken(token.slice(0, -5), SECRET)).toBeNull();
    expect(readSignedToken(`${token}extra`, SECRET)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    expect(readSignedToken(createSignedToken(PLAYER, OTHER_SECRET), SECRET)).toBeNull();
  });

  it("refuses a signature forged with the wrong algorithm inputs", () => {
    // Someone who knows the shape but not the secret: right format, right
    // length, wrong key.
    const forged = createHmac("sha256", "guessed-secret").update(PLAYER).digest("base64url");

    expect(readSignedToken(`${PLAYER}.${forged}`, SECRET)).toBeNull();
  });
});
