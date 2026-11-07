import { createHmac, scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getTravelDb } from "./db";

// Username + password login for the travel app. Logins live in the travel
// database (table travel_users, scrypt "salt:hash" per user), set with
//   node scripts/set-password.mjs <user> [--env .env.travel-prod]
// so no password data has to be pasted into the hosting dashboard. A user not
// in the table falls back to TRAVEL_USERS (JSON of the same hashes).
// Sessions are HMAC-signed with TRAVEL_SESSION_SECRET and expire after 30 days.

export const TRAVEL_COOKIE = "travel_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

/** TRAVEL_USERS, forgiving wrapping quotes, escaped quotes or a KEY= prefix. */
function envUsers(): Record<string, string> {
  let raw = (process.env.TRAVEL_USERS ?? "").trim().replace(/^TRAVEL_USERS\s*=\s*/, "");
  for (let i = 0; i < 3 && raw; i++) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") {
        raw = parsed.trim();
        continue;
      }
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      const unwrapped = raw.replace(/^['"]|['"]$/g, "").replace(/\\"/g, '"');
      if (unwrapped === raw) break;
      raw = unwrapped;
    }
  }
  return {};
}

/** The stored "salt:hash" for a user: the database first, TRAVEL_USERS for anyone not in it. */
async function storedHash(username: string): Promise<string | null> {
  try {
    const db = await getTravelDb();
    const rs = await db.execute({ sql: "SELECT hash FROM travel_users WHERE username = ?", args: [username] });
    if (rs.rows.length) return String(rs.rows[0].hash);
  } catch (err) {
    console.warn("travel_users lookup failed; falling back to TRAVEL_USERS", err);
  }
  const fromEnv = envUsers()[username] ?? null;
  // Says which store had (or lacked) the user, never the hash, so a failed sign-in can be diagnosed from the logs.
  if (!fromEnv) console.warn(`Travel sign-in: no login stored for "${username}" in travel_users or TRAVEL_USERS`);
  return fromEnv;
}

function secret(): string | null {
  return process.env.TRAVEL_SESSION_SECRET || null;
}

function sign(payload: string): string {
  return createHmac("sha256", secret() ?? "").update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function configured(): boolean {
  return secret() != null;
}

export async function validateCredentials(username: string, password: string): Promise<boolean> {
  const stored = await storedHash(username);
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) {
    console.warn(`Travel sign-in: stored login for "${username}" isn't in salt:hash form`);
    return false;
  }
  try {
    const ok = safeEqual(scryptSync(password, salt, 64).toString("hex"), hash);
    if (!ok) console.warn(`Travel sign-in: wrong password for "${username}"`);
    return ok;
  } catch {
    return false;
  }
}

export function createSessionToken(username: string): string {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const payload = `${username}:${expires}`;
  return `${payload}:${sign(payload)}`;
}

/** The signed-in username, or null for a missing, forged or expired session. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token || !secret()) return null;
  const parts = token.split(":");
  if (parts.length !== 3) return null;
  const [username, expires, sig] = parts;
  if (!/^[0-9a-f]+$/.test(sig) || !safeEqual(sign(`${username}:${expires}`), sig)) return null;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return null;
  return username;
}

export function sessionCookieHeader(token: string): string {
  return `${TRAVEL_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax${
    process.env.VERCEL ? "; Secure" : ""
  }`;
}

export function clearCookieHeader(): string {
  return `${TRAVEL_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

/** For API routes: the username, or a 401 response to return as-is. */
export function requireUser(request: NextRequest): { user: string } | { response: Response } {
  const user = verifySessionToken(request.cookies.get(TRAVEL_COOKIE)?.value);
  if (!user) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}

/**
 * The secret in a trip's calendar-feed link. Calendar apps (Google, Apple)
 * fetch the feed from their own servers and can't sign in, so the link itself
 * is the key: anyone holding it can read that one trip's itinerary.
 */
export function calendarToken(tripId: number): string {
  return sign(`calendar:${tripId}`).slice(0, 32);
}

export function validCalendarToken(tripId: number, token: string | null): boolean {
  return !!token && !!secret() && /^[0-9a-f]{32}$/.test(token) && safeEqual(calendarToken(tripId), token);
}
