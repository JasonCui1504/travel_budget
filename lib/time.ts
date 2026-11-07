// Wall-clock ↔ instant conversions in IANA time zones, using only Intl.

/** Milliseconds the zone is ahead of UTC at instant t. */
function offset(t: number, tz: string): number {
  const p = Object.fromEntries(
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
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}

/** "2026-10-14T08:05" read as wall-clock time in `tz` → the UTC instant (ms). */
export function instantOf(local: string, tz: string): number {
  const [d, hm = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, h, min);
  const first = guess - offset(guess, tz);
  return guess - offset(first, tz); // re-checked once so DST edges land right
}

/** The wall clock in `tz` at instant t. */
export function wallClock(t: number, tz: string): { date: string; hour: number; minute: number } {
  const local = t + offset(t, tz);
  const iso = new Date(local).toISOString();
  return { date: iso.slice(0, 10), hour: +iso.slice(11, 13), minute: +iso.slice(14, 16) };
}

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return !!tz;
  } catch {
    return false;
  }
}
