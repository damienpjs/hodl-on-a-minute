import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env";

import {
  COOKIE_MAX_AGE_SECONDS,
  COOKIE_NAME,
  createSignedToken,
  readSignedToken,
} from "./token";

export type Session = {
  playerId: string;
  /** True when this request minted the identity, so the caller must set the cookie. */
  isNew: boolean;
};

/**
 * Resolves the caller's identity from the signed httpOnly cookie, minting a new
 * one when there is no valid cookie.
 *
 * This never reads a player id from the request body, the query string or a
 * custom header — see `fairness-invariants`, I2.
 */
export async function getSession(): Promise<Session> {
  const store = await cookies();
  const existing = readSignedToken(
    store.get(COOKIE_NAME)?.value,
    getServerEnv().COOKIE_SECRET,
  );

  if (existing) return { playerId: existing, isNew: false };

  return { playerId: randomUUID(), isNew: true };
}

/**
 * Writes the identity cookie. Only callable from a Route Handler or Server
 * Action — Next.js forbids setting cookies while rendering.
 */
export async function setSessionCookie(playerId: string): Promise<void> {
  const store = await cookies();

  store.set(COOKIE_NAME, createSignedToken(playerId, getServerEnv().COOKIE_SECRET), {
    // Unreadable from JavaScript, so a console one-liner cannot swap identities.
    httpOnly: true,
    // Off over plain-http localhost, or the cookie is silently dropped in dev.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export { COOKIE_MAX_AGE_SECONDS, COOKIE_NAME, createSignedToken, readSignedToken };
