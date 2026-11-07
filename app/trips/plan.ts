// Small helpers shared by the Trips page and each trip's page.

export const RED = "#e66767";
export const AMBER = "#e0a63a";
export const GREEN = "#17a06b";

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative = past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

export function shortDate(d: string, weekday = false): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    ...(weekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
  });
}

/** The day an expense was logged, in the viewer's time zone: "Oct 12". */
export function loggedDay(createdAt: string): string {
  const t = Date.parse(createdAt.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "2026-10" → "Oct". */
export function shortMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

/** How urgent a free-cancellation deadline is: wording and colour. */
export function deadline(cancelBy: string, today: string): { text: string; color: string; passed: boolean } {
  const n = daysUntil(cancelBy, today);
  if (n < 0) return { text: `ended ${shortDate(cancelBy)}`, color: "var(--faint)", passed: true };
  const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
  return { text: when, color: n <= 3 ? RED : n <= 7 ? AMBER : "var(--subtle)", passed: false };
}

/** "America/New_York" → "New York time". */
export function tzLabel(tz: string): string {
  return tz ? `${tz.split("/").pop()!.replace(/_/g, " ")} time` : "";
}

/** Hours as a time of day, minutes kept when there are any: 9 → "9 AM", 9.5 → "9:30 AM", 24 → "12 AM". */
export function timeLabel(h: number): string {
  const total = Math.round(h * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const m = total % 60;
  return `${hh % 12 === 0 ? 12 : hh % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${hh < 12 ? "AM" : "PM"}`;
}

/** "18:05" → "6:05 PM". */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** WMO weather codes (Open-Meteo) → an emoji and a word. */
export function weatherLook(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "☀️", label: "Clear" };
  if (code <= 2) return { icon: "🌤️", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "Cloudy" };
  if (code <= 48) return { icon: "🌫️", label: "Fog" };
  if (code <= 57) return { icon: "🌦️", label: "Drizzle" };
  if (code <= 67) return { icon: "🌧️", label: "Rain" };
  if (code <= 77) return { icon: "🌨️", label: "Snow" };
  if (code <= 82) return { icon: "🌧️", label: "Showers" };
  if (code <= 86) return { icon: "🌨️", label: "Snow showers" };
  return { icon: "⛈️", label: "Thunderstorms" };
}

/**
 * The UTC instant of a wall-clock time in a time zone (or the viewer's own
 * zone when tz is ""). Corrects by the zone's offset, re-checked once so DST
 * edges land right.
 */
export function zonedInstant(date: string, hour: number, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // Minutes, so half hours (9.5) survive: Date takes whole hours only.
  const min = Math.round(hour * 60);
  if (!tz) return new Date(y, m - 1, d, 0, min).getTime();
  const guess = Date.UTC(y, m - 1, d, 0, min);
  const offset = (t: number) => {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        })
          .formatToParts(t)
          .map((p) => [p.type, p.value])
      );
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - t;
    } catch {
      return 0;
    }
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}
