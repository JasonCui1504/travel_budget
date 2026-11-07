import { NextRequest } from "next/server";
import { TRAVEL_COOKIE, validCalendarToken, verifySessionToken } from "@/lib/auth";
import { getTrip, listPeople } from "@/lib/queries";
import { instantOf } from "@/lib/time";

// A trip's whole itinerary as an iCalendar feed: every calendar event, each
// stay as an all-day block, and free-cancellation deadlines. Google and Apple
// Calendar subscribe to it with the token in the link, and refresh it on
// their own schedule.

const STATUS: Record<string, string> = {
  not_booked: "Not booked",
  booked: "Booked",
  unnecessary: "Booking unnecessary",
  transit: "Transit",
};

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);

/** Lines over 75 bytes continue on the next line after a space (RFC 5545). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const signedIn = verifySessionToken(request.cookies.get(TRAVEL_COOKIE)?.value);
  if (!signedIn && !validCalendarToken(id, request.nextUrl.searchParams.get("token"))) {
    return new Response("Not found", { status: 404 });
  }
  const [data, people] = await Promise.all([getTrip(id), listPeople()]);
  if (!data) return new Response("Not found", { status: 404 });
  const who = (pid: number) => people.find((p) => p.id === pid)?.name ?? "";
  const hm = (local: string) => {
    const [h, m] = local.slice(11, 16).split(":").map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const { trip, events, days } = data;

  let tz = "";
  try {
    if (trip.time_zone) tz = new Intl.DateTimeFormat("en-US", { timeZone: trip.time_zone }).resolvedOptions().timeZone;
  } catch {
    tz = "";
  }
  // With a time zone, times are pinned to it; without, they're "floating" (read as each viewer's local time).
  const at = (date: string, hour: number) => {
    const [d, h] = hour >= 24 ? [nextDay(date), 0] : [date, hour];
    const min = Math.round(h * 60); // half hours: 9.5 → 09:30
    const v = `${ymd(d)}T${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;
    return tz ? `;TZID=${tz}:${v}` : `:${v}`;
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  // Fixed (event UIDs), so subscriptions made before the move to travel.jascui.com
  // and after it name the same events alike.
  const host = "travel.photographyjson.com";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//travel.jascui.com//Travel planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(trip.name)}`,
    ...(tz ? [`X-WR-TIMEZONE:${tz}`] : []),
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  const utc = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  for (const e of events) {
    // Flights are exact instants: one entry per traveller's flight, in UTC (calendars show them in local time).
    if (e.flights.length) {
      for (const f of e.flights) {
        if (!f.from_tz || !f.to_tz) continue;
        lines.push(
          "BEGIN:VEVENT",
          `UID:flight-${f.id}@${host}`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${utc(instantOf(f.depart, f.from_tz))}`,
          `DTEND:${utc(instantOf(f.arrive, f.to_tz))}`,
          `SUMMARY:${esc(`✈ ${who(f.person_id)}: ${f.from_code} → ${f.to_code}${f.flight_no ? ` (${f.flight_no})` : ""}`)}`,
          `LOCATION:${esc(`${f.from_code} ${f.from_city}`)}`,
          `DESCRIPTION:${esc(
            [
              e.title,
              `Departs ${f.from_code} ${hm(f.depart)}, arrives ${f.to_code} ${hm(f.arrive)}${f.arrive.slice(0, 10) > f.depart.slice(0, 10) ? " (next day)" : ""} — local times`,
              e.notes,
            ]
              .filter(Boolean)
              .join("\n")
          )}`,
          "END:VEVENT"
        );
      }
      continue;
    }
    const details = [
      STATUS[e.status] ?? "",
      e.notes,
      e.map_link && `Map: ${e.map_link}`,
      e.reservation_link && `Reservation: ${e.reservation_link}`,
      e.other_link && `Link: ${e.other_link}`,
    ].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      `UID:event-${e.id}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART${at(e.date, e.start_hour)}`,
      `DTEND${at(e.date, e.end_hour)}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      ...(details.length ? [`DESCRIPTION:${esc(details.join("\n"))}`] : []),
      "END:VEVENT"
    );
  }

  // Stays and rental cars, each day as a booking. Consecutive days with the same one become one all-day block.
  const bookings = (["stay", "car"] as const).flatMap((kind) =>
    days
      .map((d) =>
        kind === "stay"
          ? { kind, date: d.date, name: d.accommodation, cancel_by: d.cancel_by, non_refundable: d.non_refundable, link: d.stay_link, notes: "" }
          : { kind, date: d.date, name: d.car, cancel_by: d.car_cancel_by, non_refundable: d.car_non_refundable, link: d.car_link, notes: d.car_notes }
      )
      .filter((b) => b.name)
      .sort((a, b) => a.date.localeCompare(b.date))
  );
  for (let i = 0; i < bookings.length; ) {
    let j = i;
    const b = bookings[i];
    while (
      j + 1 < bookings.length &&
      bookings[j + 1].kind === b.kind &&
      bookings[j + 1].name === b.name &&
      bookings[j + 1].date === nextDay(bookings[j].date)
    )
      j++;
    const note = [b.non_refundable ? "Non-refundable" : b.cancel_by ? `Free cancellation until ${b.cancel_by}` : "", b.notes, b.link].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      // Stays keep their original ids, so existing subscriptions don't duplicate them.
      `UID:${b.kind}-${trip.id}-${b.date}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(b.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(bookings[j].date))}`,
      `SUMMARY:${esc(`${b.kind === "car" ? "Rental car" : "Stay"}: ${b.name}`)}`,
      ...(note.length ? [`DESCRIPTION:${esc(note.join("\n"))}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
    i = j + 1;
  }

  // One reminder per distinct deadline and booking.
  const deadlines = new Map(
    bookings.filter((b) => b.cancel_by && !b.non_refundable).map((b) => [`${b.kind}|${b.cancel_by}|${b.name}`, b])
  );
  for (const d of deadlines.values()) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d.kind === "car" ? "car-cancel" : "cancel"}-${trip.id}-${d.cancel_by}-${ymd(d.date)}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(d.cancel_by)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(d.cancel_by))}`,
      `SUMMARY:${esc(`Last day to cancel free: ${d.kind === "car" ? "rental car " : ""}${d.name}`)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  const filename = `${trip.name.replace(/[^\w -]+/g, "").trim() || "trip"}.ics`;
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `${request.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
      // Fetchable (robots.ts allows it, for Google Calendar) but never indexed.
      "X-Robots-Tag": "noindex",
    },
  });
}
