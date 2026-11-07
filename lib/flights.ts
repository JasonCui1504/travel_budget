import { airport } from "./airports";
import { instantOf, wallClock } from "./time";

// A transit event's flights (one per traveller), with departure and arrival
// entered as on the ticket: local time at each airport. These helpers turn
// them into instants and place the event on the trip's calendar.

export type FlightInput = {
  person_id: number;
  flight_no: string;
  from_code: string;
  to_code: string;
  /** "YYYY-MM-DDTHH:MM", local at the departure airport. */
  depart: string;
  /** "YYYY-MM-DDTHH:MM", local at the arrival airport. */
  arrive: string;
};

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Checks a flight; returns its UTC departure/arrival or an error message. */
export function checkFlight(f: FlightInput): { dep: number; arr: number; fromTz: string; toTz: string } | string {
  const from = airport(f.from_code);
  const to = airport(f.to_code);
  if (!from) return `Unknown airport code "${f.from_code}"`;
  if (!to) return `Unknown airport code "${f.to_code}"`;
  if (!LOCAL.test(f.depart) || !LOCAL.test(f.arrive)) return "Departure and arrival need a date and time";
  const dep = instantOf(f.depart, from.tz);
  const arr = instantOf(f.arrive, to.tz);
  if (arr <= dep) return `${f.from_code}→${f.to_code} arrives before it departs — check the times (they're local to each airport)`;
  if (arr - dep > 30 * 3_600_000) return `${f.from_code}→${f.to_code} is over 30 hours — check the dates`;
  return { dep, arr, fromTz: from.tz, toTz: to.tz };
}

/**
 * Where the event goes on the calendar, in the trip's zone: from the earliest
 * departure (rounded down to the hour) to the latest arrival (rounded up),
 * kept within the departure day.
 */
export function placement(times: { dep: number; arr: number }[], tz: string) {
  const dep = Math.min(...times.map((t) => t.dep));
  const arr = Math.max(...times.map((t) => t.arr));
  const a = wallClock(dep, tz);
  const b = wallClock(arr, tz);
  // To the half hour: start rounded down, end rounded up.
  const start = a.hour + (a.minute >= 30 ? 0.5 : 0);
  const end = b.date > a.date ? 24 : Math.min(24, b.hour + (b.minute === 0 ? 0 : b.minute <= 30 ? 0.5 : 1));
  return { date: a.date, start_hour: Math.min(23.5, start), end_hour: Math.max(start + 0.5, end) };
}
