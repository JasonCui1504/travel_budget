import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseCoords, placeName } from "@/lib/coords";

/** Only maps hosts are followed, so this can't be used to fetch arbitrary pages. */
const HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|maps\.apple\.com|maps\.apple)$/i;
const UA = "Mozilla/5.0 (compatible; travel.jascui.com travel planner)";

/**
 * ?url=<maps link> → { lat, lng } for share links that don't carry their
 * coordinates (maps.app.goo.gl/…): follows the redirects, then reads the
 * final link, or the page's preview image (which is centred on the place).
 */
export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  let url = (request.nextUrl.searchParams.get("url") ?? "").trim();
  const direct = parseCoords(url);
  if (direct) return Response.json({ ...direct, name: placeName(url) });
  try {
    for (let hop = 0; hop < 6; hop++) {
      const u = new URL(url);
      if (u.protocol !== "https:" || !HOSTS.test(u.hostname)) break;
      const res = await fetch(u, { redirect: "manual", headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(6000) });
      const next = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && next) {
        url = new URL(next, u).toString();
        const found = parseCoords(url);
        if (found) return Response.json({ ...found, name: placeName(url) });
        continue;
      }
      if (!res.ok) break;
      // The final page: its preview image (og:image) is a static map centred on the place.
      const html = (await res.text()).slice(0, 400_000);
      const og = html.match(/<meta[^>]+(?:property|itemprop)="(?:og:)?image"[^>]+content="([^"]+)"/i)?.[1];
      const found = (og && parseCoords(og.replace(/&amp;/g, "&").replace(/%2C/gi, ","))) || parseCoords(url);
      if (found) return Response.json({ ...found, name: placeName(url) || ogTitle(html) });
      break;
    }
  } catch {
    // Unreachable or not a link: fall through.
  }
  return Response.json({ error: "Couldn't read a location from that link" }, { status: 422 });
}

/** The place name from a Google Maps page's preview title ("Ichiran Shibuya · 1-22-7 Jinnan…"). */
function ogTitle(html: string): string {
  const t = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ?? "";
  const name = t.split(" · ")[0].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  return name === "Google Maps" || parseCoords(name) ? "" : name;
}
