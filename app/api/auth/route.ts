import { NextRequest } from "next/server";
import {
  clearCookieHeader,
  configured,
  createSessionToken,
  sessionCookieHeader,
  TRAVEL_COOKIE,
  validateCredentials,
  verifySessionToken,
} from "@/lib/auth";

// Per-IP throttle on login attempts, cleared on success (best effort: in-memory, per instance).
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function limited(ip: string): boolean {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || now > e.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > MAX_ATTEMPTS;
}

export async function GET(request: NextRequest) {
  const user = verifySessionToken(request.cookies.get(TRAVEL_COOKIE)?.value);
  if (!user) return Response.json({ authed: false }, { status: 401 });
  return Response.json({ authed: true, user });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (limited(ip)) {
    return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }
  if (!configured()) return Response.json({ error: "Login isn't configured" }, { status: 500 });
  const { username, password } = await request.json();
  if (typeof username !== "string" || typeof password !== "string" || !(await validateCredentials(username.trim().toLowerCase(), password))) {
    return Response.json({ error: "Invalid username or password" }, { status: 401 });
  }
  attempts.delete(ip);
  const user = username.trim().toLowerCase();
  const res = Response.json({ ok: true, user });
  res.headers.set("Set-Cookie", sessionCookieHeader(createSessionToken(user)));
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.set("Set-Cookie", clearCookieHeader());
  return res;
}
