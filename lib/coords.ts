// Reading coordinates out of what people paste: "35.0037, 135.7681", or a
// Google Maps / Apple Maps link. Used in the browser (pin picker) and on the
// server (map links on events, resolving short share links).

export type LatLng = { lat: number; lng: number };

const valid = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
    ? { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }
    : null;

const PAIR = /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

/**
 * Coordinates in pasted text or a maps link, or null:
 * - "35.0037, 135.7681" (what Google Maps copies from a dropped pin)
 * - google.com/maps/place/…/@35.0,135.7,17z or …!3d35.0!4d135.7 (the place itself, preferred over the view)
 * - ?q=35.0,135.7 · ?query= · ?ll= · ?destination= · ?daddr= · Apple's ?coordinate=
 */
export function parseCoords(text: string): LatLng | null {
  const s = text.trim();
  if (!s) return null;
  // A bare pair (optionally with degree signs).
  const bare = s.replace(/°/g, "").match(new RegExp(`^${PAIR.source}$`));
  if (bare) return valid(+bare[1], +bare[2]);
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    // Not URL-encoded: read it as is.
  }
  // The place's own position in a Google place link.
  const place = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place) return valid(+place[1], +place[2]);
  for (const key of ["q", "query", "ll", "sll", "coordinate", "destination", "daddr", "center"]) {
    const m = decoded.match(new RegExp(`[?&]${key}=(?:loc:)?${PAIR.source}`));
    if (m) return valid(+m[1], +m[2]);
  }
  // The map's view centre (google.com/maps/@35.0,135.7,15z).
  const at = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return valid(+at[1], +at[2]);
  return null;
}

/** Short share links that only say where they go once followed (maps.app.goo.gl/…, goo.gl/maps/…). */
export function isShortMapsLink(text: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(text.trim());
}

/** A pin as text for the Location box when nothing else names it. */
export const coordsLabel = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

/** Pasted text → coordinates: read directly, or for a share link, followed by the server (browser only). */
export async function coordsFrom(text: string): Promise<(LatLng & { name?: string }) | null> {
  const direct = parseCoords(text);
  if (direct) return { ...direct, name: placeName(text) };
  if (!/^https?:\/\//i.test(text.trim())) return null;
  try {
    const res = await fetch(`/api/resolve-link?url=${encodeURIComponent(text.trim())}`);
    return res.ok ? ((await res.json()) as LatLng & { name?: string }) : null;
  } catch {
    return null;
  }
}

/** The place name in a Google Maps place link (…/maps/place/Ichiran+Shibuya/@…), or "". */
export function placeName(url: string): string {
  const m = url.match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return "";
  try {
    const name = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    // A place link for bare coordinates names them, which says nothing new.
    return parseCoords(name) ? "" : name;
  } catch {
    return "";
  }
}

/** Whether pasted text is a maps link or coordinates (to turn into a pin) rather than a place to search. */
export function looksLikePin(text: string): boolean {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return /(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl|maps\.apple)/i.test(t);
  // Bare coordinates only once they look pasted (4+ decimals each), not while a number is being typed.
  return /^-?\d{1,2}\.\d{4,}°?\s*,\s*-?\d{1,3}\.\d{4,}°?$/.test(t) && !!parseCoords(t);
}
