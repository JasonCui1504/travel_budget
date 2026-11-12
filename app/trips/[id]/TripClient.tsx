"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isFlight } from "@/lib/flight";
import type { EventStatus } from "@/lib/db";
import type { EstimatedExpense, Expense, Person, Trip, TripDay, TripEvent, TripIdea } from "@/lib/queries";
import type { DayWeather } from "@/lib/weather";
import { api, btnCls, ghostCls, inputCls, usd } from "../../api";
import FlightFields, { emptyFlight, flightPayload, routeLabel, type FlightValue } from "../../FlightFields";
import { Linkified } from "./Linkified";
import LocationInput from "./LocationInput";
import { instantOf, wallClock } from "@/lib/time";
import {
  dayShift,
  flightDrafts,
  flightLength,
  flightSegments,
  FlightsEditor,
  spanSegments,
  timeOf,
  zoneAbbr,
  type FlightDraft,
  type FlightSegment,
} from "./Flights";
import type { Flight } from "@/lib/queries";
import EstimatedExpenses from "./EstimatedExpenses";
import TripDoc from "./TripDoc";
import { AMBER, clock, deadline, loggedDay, RED, shortDate, shortMonth, timeLabel, tzLabel, weatherLook } from "../plan";

// Leaflet needs the browser, so the map loads client-side only.
const TripMap = dynamic(() => import("../TripMap").then((m) => m.TripMap), {
  ssr: false,
  loading: () => <p className="text-sm text-faint">Loading map…</p>,
});

type WeatherDay = { place: string; weather?: DayWeather; later?: string } | null;

// The sheet's legend colours, with dark text from the same family.
const STATUS: Record<EventStatus, { label: string; bg: string; fg: string }> = {
  none: { label: "No status", bg: "#2a3a31", fg: "#deeade" },
  unnecessary: { label: "Booking unnecessary", bg: "#D9D2E9", fg: "#26215C" },
  not_booked: { label: "Not booked", bg: "#FCE5CD", fg: "#4A1B0C" },
  booked: { label: "Booked", bg: "#D9EAD3", fg: "#173404" },
  transit: { label: "Transit", bg: "#C9DAF8", fg: "#042C53" },
};
const LINKS = [
  { key: "map_link", label: "Map", icon: "📍" },
  { key: "reservation_link", label: "Reservation", icon: "🎟" },
  { key: "other_link", label: "Link", icon: "🔗" },
] as const;
const MEALS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
] as const;
const GREEN = "#17a06b";

function hourLabel(h: number) {
  const hh = h % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12} ${hh < 12 ? "AM" : "PM"}`;
}

/** 1.5 → "1h 30m", 0.25 → "15m", 2 → "2h". */
function lengthLabel(h: number) {
  const min = Math.round(h * 60);
  return [Math.floor(min / 60) && `${Math.floor(min / 60)}h`, min % 60 && `${min % 60}m`].filter(Boolean).join(" ");
}

/** The calendar works in quarter hours: 0, 0.25, … 23.75. */
const STEP = 0.25;
const SLOTS = Array.from({ length: 24 / STEP }, (_, i) => i * STEP);
/** An hour (9.75) as "09:45". */
const hhmm = (h: number) => {
  const min = Math.round(h * 60);
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
};

/** How tall the calendar's hours are drawn, ×1 to ×4; kept per device. */
const ZOOMS = [1, 1.5, 2, 3, 4];
const ZOOM_KEY = "travel-calendar-zoom";
function useZoom(): [number, (v: number) => void] {
  const stored = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(ZOOM_KEY, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(ZOOM_KEY, cb);
      };
    },
    () => {
      try {
        return Number(localStorage.getItem(ZOOM_KEY)) || 1;
      } catch {
        return 1;
      }
    },
    () => 1
  );
  const set = (v: number) => {
    try {
      localStorage.setItem(ZOOM_KEY, String(v));
    } catch {
      // Private mode: the zoom lasts for this page only.
    }
    window.dispatchEvent(new Event(ZOOM_KEY));
  };
  return [ZOOMS.includes(stored) ? stored : 1, set];
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

// Which zone View mode shows times in: "local" (the viewer's device, the default),
// "trip" (the zone events were entered in), or any IANA zone. Kept per device.
const ZONE_KEY = "travel-view-zone";
function useViewZone(): [string, (v: string) => void] {
  const stored = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(ZONE_KEY, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(ZONE_KEY, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(ZONE_KEY) ?? "local";
      } catch {
        return "local";
      }
    },
    () => "local"
  );
  const set = (v: string) => {
    try {
      localStorage.setItem(ZONE_KEY, v);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    window.dispatchEvent(new Event(ZONE_KEY));
  };
  return [stored, set];
}

/** The viewer's own time zone; "" while rendering on the server. */
function useDeviceZone() {
  return useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => ""
  );
}

function dayLabel(d: string, long = false) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: long ? "long" : "short",
    month: "short",
    day: "numeric",
  });
}

function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const d = new Date(a + "T00:00:00Z");
  while (d.toISOString().slice(0, 10) <= b && out.length < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const isConfirmed = (status: string) => /confirm/i.test(status);

/** True on phone-width screens (under Tailwind's `sm`). */
function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(max-width: 639px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false
  );
}

/** How long a finger must rest on the calendar in Edit before it starts a drag or resize. */
const HOLD_MS = 450;
/** Moving a finger further than this (px) before the hold fires means it's a scroll. */
const HOLD_SLOP = 10;

/** Keep a drag's moves coming to `el` even when the pointer leaves it. */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not an active pointer (e.g. a synthetic event); the drag still works while over the column.
  }
}

/** Side-by-side lanes for events that overlap within one day. */
/** What the calendar draws: an event, or one traveller's flight (or half of an overnight one) from a transit event. */
type Block = TripEvent & { seg?: FlightSegment & { flight: Flight } };

function layout(events: Block[]) {
  const sorted = [...events].sort((a, b) => a.start_hour - b.start_hour || b.end_hour - a.end_hour);
  const laneEnds: number[] = [];
  const placed = sorted.map((e) => {
    let lane = laneEnds.findIndex((end) => end <= e.start_hour);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = e.end_hour;
    return { e, lane };
  });
  return placed.map((p) => ({
    ...p,
    lanes: Math.max(1, ...placed.filter((q) => q.e.start_hour < p.e.end_hour && p.e.start_hour < q.e.end_hour).map((q) => q.lane + 1)),
  }));
}

type Draft = {
  id?: number;
  /** Set when the event comes from an idea dragged onto the calendar; the idea is removed once saved. */
  idea_id?: number;
  date: string;
  start_hour: number;
  end_hour: number;
  title: string;
  status: EventStatus;
  notes: string;
  location: string;
  map_link: string;
  reservation_link: string;
  other_link: string;
  /** Transit only: a row per traveller (unset until the Transit status is picked). */
  flights?: FlightDraft[];
  /** The event had flights when opened, so saving without any clears them. */
  hadFlights?: boolean;
};

/** A Google Maps search for a typed place, used when no map link was pasted. */
const mapsSearch = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

const emptyDraft = (date: string, start: number, end: number): Draft => ({
  date,
  start_hour: start,
  end_hour: end,
  title: "",
  status: "none",
  notes: "",
  location: "",
  map_link: "",
  reservation_link: "",
  other_link: "",
});

const blankDay = (date: string): TripDay => ({
  date,
  accommodation: "",
  accommodation_status: "",
  notes: "",
  breakfast: "",
  lunch: "",
  dinner: "",
  cancellation_policy: "",
  stay_link: "",
  stay_address: "",
  cancel_by: "",
  non_refundable: false,
  car: "",
  car_status: "",
  car_cancel_by: "",
  car_non_refundable: false,
  car_link: "",
  car_notes: "",
});

/** The stay's address, with place search; saved when a suggestion is picked or the box is left. */
function StayAddress({ saved, tripId, className, onSave }: { saved: string; tripId: number; className: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(saved);
  const save = (v: string) => v.trim() !== saved && onSave(v.trim());
  return (
    <div onBlur={() => save(value)}>
      <LocationInput
        value={value}
        onChange={setValue}
        onPick={save}
        tripId={tripId}
        placeholder="📍 Address (for the map)"
        className={className}
        label="Stay address"
      />
    </div>
  );
}

export default function TripClient({
  trip,
  events,
  days,
  expenses,
  people,
  user,
  categories,
  ideas,
  estimates,
  calendarToken,
}: {
  trip: Trip;
  events: TripEvent[];
  days: TripDay[];
  expenses: (Expense & { person_name: string })[];
  people: Person[];
  user: string;
  categories: string[];
  ideas: TripIdea[];
  estimates: EstimatedExpense[];
  calendarToken: string;
}) {
  const router = useRouter();
  const phone = usePhone();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const editing = mode === "edit";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<TripEvent | null>(null);
  const [editTrip, setEditTrip] = useState(false);
  const [tripForm, setTripForm] = useState({
    name: trip.name,
    start_date: trip.start_date,
    end_date: trip.end_date,
    time_zone: trip.time_zone,
  });
  // An idea being dragged over the calendar: where it would land.
  const [dropAt, setDropAt] = useState<{ date: string; hour: number } | null>(null);
  const [menu, setMenu] = useState(false);
  // Edit mode: empty day sections opened with their "+" button ("date|section").
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [weather, setWeather] = useState<{
    days: Record<string, WeatherDay>;
    timezone: string;
    /** False when no event has a location the forecast can use. */
    located: boolean;
  } | null>(null);
  // Drag to pick a time span (new event), or drag an event's top or bottom edge (resize).
  const [drag, setDrag] = useState<{ date: string; anchor: number; cur: number } | null>(null);
  const [resize, setResize] = useState<{ id: number; edge: "start" | "end"; start: number; end: number } | null>(null);
  const [zoom, setZoom] = useZoom();
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const calendarRef = useRef<HTMLDivElement>(null);
  // On touch, a drag or resize starts only after the finger is held still (so scrolling in Edit
  // doesn't add or stretch events); `gesture` is true while one is under way.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const gesture = useRef(false);
  useEffect(() => {
    // Once a held drag is under way, keep the finger's moves from scrolling the page.
    const stopScroll = (ev: TouchEvent) => {
      if (gesture.current && ev.cancelable) ev.preventDefault();
    };
    document.addEventListener("touchmove", stopScroll, { passive: false });
    return () => {
      document.removeEventListener("touchmove", stopScroll);
      if (hold.current) clearTimeout(hold.current.timer);
    };
  }, []);

  /** Run `begin` now for a mouse or pen, or after a still long-press for a finger. */
  function pressThen(ev: React.PointerEvent, el: Element, begin: () => void) {
    const start = () => {
      gesture.current = true;
      capture(el, ev.pointerId);
      begin();
    };
    if (ev.pointerType !== "touch") return start();
    endHold();
    hold.current = {
      x: ev.clientX,
      y: ev.clientY,
      timer: setTimeout(() => {
        hold.current = null;
        navigator.vibrate?.(15);
        start();
      }, HOLD_MS),
    };
  }

  /** Forget a long-press that hasn't fired yet. */
  function endHold() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }

  const dates = datesBetween(trip.start_date, trip.end_date);
  const today = new Date().toISOString().slice(0, 10);
  const [phoneDay, setPhoneDay] = useState(dates.includes(today) ? today : dates[0]);
  const dayInfo = new Map(days.map((d) => [d.date, d]));
  // Event locations decide where the forecast is for; refetch when they change.
  const locKey = events.map((e) => `${e.date}|${e.location}`).join(";") + trip.start_date + trip.end_date;
  useEffect(() => {
    let stop = false;
    let tries = 0;
    async function load() {
      try {
        const res = await fetch(`/api/trips/${trip.id}/weather`);
        const d = res.ok ? await res.json() : null;
        if (stop || !d) return;
        setWeather(d);
        // New locations are still being looked up: ask again shortly.
        if (d.pending > 0 && ++tries < 10) setTimeout(load, 2000);
      } catch {
        // Offline or the forecast service is down: the calendar works without it.
      }
    }
    load();
    return () => {
      stop = true;
    };
  }, [trip.id, locKey]);
  // Events are entered in the trip's zone. Edit mode shows that zone; View mode
  // shows the viewer's own (or the one they picked), converting every event.
  const tripTz = trip.time_zone;
  const deviceTz = useDeviceZone();
  const [zoneChoice, setZoneChoice] = useViewZone();
  const viewTz =
    editing || !tripTz
      ? tripTz
      : zoneChoice === "trip"
        ? tripTz
        : zoneChoice !== "local" && zoneChoice
          ? zoneChoice
          : deviceTz || tripTz;
  const converting = !!tripTz && !!viewTz && viewTz !== tripTz;
  const eventInstant = (date: string, hour: number) => {
    // 24 = midnight at the end of the day: an hour past 23:00.
    return instantOf(`${date}T${hhmm(Math.min(hour, 23))}`, tripTz) + (hour >= 24 ? 3_600_000 : 0);
  };

  // Each flight is its own block at its real times; other events are converted
  // (and split at midnight) when shown in another zone.
  const blocks: Block[] = events.flatMap((e) =>
    e.flights.length
      ? e.flights.flatMap((f) =>
          flightSegments(f, viewTz || f.to_tz).map((seg) => ({
            ...e,
            date: seg.date,
            start_hour: seg.start,
            end_hour: seg.end,
            seg: { ...seg, flight: f },
          }))
        )
      : converting
        ? spanSegments(eventInstant(e.date, e.start_hour), eventInstant(e.date, e.end_hour), viewTz).map((seg) => ({
            ...e,
            date: seg.date,
            start_hour: seg.start,
            end_hour: seg.end,
          }))
        : [e]
  );
  // Converted events can land a day before or after the trip: widen the columns (by a day at most) to show them.
  const cols = (() => {
    if (!converting) return dates;
    const near = blocks.map((b) => b.date).filter((d) => d >= addDays(dates[0], -1) && d <= addDays(dates[dates.length - 1], 1));
    const lo = [dates[0], ...near].sort()[0];
    const hi = [dates[dates.length - 1], ...near].sort().pop()!;
    return datesBetween(lo, hi);
  })();
  const inTrip = blocks.filter((b) => cols.includes(b.date));
  const outside = events.filter((e) => !inTrip.some((b) => b.id === e.id)).length;

  // Edit shows the whole day. View uses the trip's chosen hours, or fits the events.
  // On a phone (one day at a time) the hours fit that day's events, not the whole trip's.
  const fitTo = phone && !editing ? inTrip.filter((b) => b.date === phoneDay) : inTrip;
  const autoFrom = Math.max(0, Math.floor(Math.min(7, ...fitTo.map((e) => e.start_hour))) - (fitTo.length ? 1 : 0));
  const autoTo = Math.min(24, Math.ceil(Math.max(22, ...fitTo.map((e) => e.end_hour))));
  // The trip's chosen view hours are in its own zone, so a converted view fits the events instead.
  const from = editing ? 0 : converting ? autoFrom : (trip.view_start_hour ?? autoFrom);
  const to = editing ? 24 : Math.max(from + 1, converting ? autoTo : (trip.view_end_hour ?? autoTo));
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  // Pixels per hour.
  const row = (phone && !editing ? 48 : 36) * zoom;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const putTrip = (patch: Record<string, unknown>) =>
    api(`trips/${trip.id}`, "PUT", { name: trip.name, start_date: trip.start_date, end_date: trip.end_date, done: trip.done, ...patch });

  async function saveEvent() {
    if (!draft) return;
    const { idea_id, flights, hadFlights, ...body } = { ...draft, trip_id: trip.id };
    const chosen = draft.status === "transit" ? (flights ?? []).filter((f) => f.on) : [];
    let eventId = draft.id;
    const ok = await run(async () => {
      if (eventId) await api(`events/${eventId}`, "PUT", body);
      else eventId = (await api<{ id: number }>("events", "POST", body)).id;
      // Flights move the event to their times (in the trip's zone) on the server.
      if (chosen.length || hadFlights) await api(`events/${eventId}/flights`, "PUT", { flights: chosen });
      if (idea_id) await api(`ideas/${idea_id}`, "DELETE");
    });
    if (ok) setDraft(null);
    // The event was created but its flights were refused: keep editing that event, not a new one.
    else if (eventId && !draft.id) setDraft({ ...draft, id: eventId });
  }

  /** Saves just the changed fields of one day. */
  function saveDay(date: string, patch: Partial<TripDay>) {
    run(() => api("days", "PUT", { trip_id: trip.id, date, ...patch }));
  }

  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? "";

  /** An event's times in the zone being shown, plus the trip's own times when they differ. */
  function viewingTimes(e: TripEvent) {
    const own = `${timeLabel(e.start_hour)} – ${timeLabel(e.end_hour)}`;
    if (!converting) return own;
    const pieces = spanSegments(eventInstant(e.date, e.start_hour), eventInstant(e.date, e.end_hour), viewTz);
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    const shown = `${first.date !== e.date ? `${dayLabel(first.date)}, ` : ""}${timeLabel(first.start)} – ${timeLabel(last.end)}${
      last.date !== first.date ? ` (${dayLabel(last.date)})` : ""
    }`;
    return `${shown} your view · ${own} ${tzLabel(tripTz)}`;
  }

  function openEvent(id: number) {
    const ev = events.find((x) => x.id === id);
    if (ev) (editing ? openEditor : setViewing)(ev);
  }

  /** A flight's block: who and the route, with the ticket's local times; overnight halves say which end they are. */
  function flightBlock(seg: NonNullable<Block["seg"]>, tall: boolean) {
    const f = seg.flight;
    // Just who and where; exact times, flight number and length are in the popup.
    const route = seg.part === "arrives" ? `→ ${f.to_code}` : `${f.from_code} → ${f.to_code}${seg.part === "departs" ? " ↷" : ""}`;
    const who = `✈ ${personName(f.person_id)}`;
    return tall ? (
      <>
        <span className="truncate">{who}</span>
        <span className="truncate text-[11px] opacity-75">{route}</span>
      </>
    ) : (
      <span className="truncate">
        {who} <span className="opacity-75">· {route}</span>
      </span>
    );
  }

  /** The quarter hour under the pointer in a day column, clamped to the grid. */
  function hourAt(date: string, clientY: number) {
    const el = colRefs.current.get(date);
    if (!el) return from;
    const y = clientY - el.getBoundingClientRect().top;
    return Math.max(from, Math.min(to - STEP, from + Math.floor(y / row / STEP) * STEP));
  }

  /** Start dragging an event's top or bottom edge. */
  function startResize(ev: React.PointerEvent, date: string, r: NonNullable<typeof resize>) {
    ev.stopPropagation();
    const col = colRefs.current.get(date);
    if (col) pressThen(ev, col, () => setResize(r));
  }

  /** The quarter-hour line nearest the pointer (for an edge being dragged), clamped to the grid. */
  function edgeAt(date: string, clientY: number) {
    const el = colRefs.current.get(date);
    if (!el) return from;
    const y = clientY - el.getBoundingClientRect().top;
    return Math.max(from, Math.min(to, from + Math.round(y / row / STEP) * STEP));
  }

  function openEditor(e: TripEvent) {
    setViewing(null);
    setMode("edit");
    setDraft({
      id: e.id,
      date: e.date,
      start_hour: e.start_hour,
      end_hour: e.end_hour,
      title: e.title,
      status: e.status,
      notes: e.notes,
      location: e.location,
      map_link: e.map_link,
      reservation_link: e.reservation_link,
      other_link: e.other_link,
      flights: e.flights.length ? flightDrafts(people, e.flights, e.date, e.start_hour, e.end_hour) : undefined,
      hadFlights: e.flights.length > 0,
    });
  }

  // ---- trip expenses form ----
  const me = people.find((p) => p.slug === user) ?? people[0];
  const [xForm, setXForm] = useState({
    person_id: me?.id ?? 0,
    month: trip.start_date.slice(0, 7),
    category: "",
    kind: "travel",
    amount: "",
    notes: "",
  });
  const [xFlight, setXFlight] = useState<FlightValue>(emptyFlight);
  const spent = expenses.reduce((s, x) => s + x.amount, 0);

  /** One day's column of hours with its events; shared by the grid and the phone day view. */
  function dayColumn(d: string) {
    const placed = layout(inTrip.filter((e) => e.date === d));
    const sel = drag && drag.date === d ? { a: Math.min(drag.anchor, drag.cur), b: Math.max(drag.anchor, drag.cur) + STEP } : null;
    return (
      <div
        ref={(el) => {
          if (el) colRefs.current.set(d, el);
        }}
        className={`relative select-none ${editing ? "cursor-crosshair" : ""}`}
        style={{ height: hours.length * row, WebkitTouchCallout: editing ? "none" : undefined }}
        // A long-press would otherwise open the phone's context menu.
        onContextMenu={(ev) => editing && ev.preventDefault()}
        onDragOver={(ev) => {
          if (!ev.dataTransfer.types.includes("application/x-trip-idea")) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "copy";
          const h = hourAt(d, ev.clientY);
          if (dropAt?.date !== d || dropAt.hour !== h) setDropAt({ date: d, hour: h });
        }}
        // Moving between the hour rows inside the column also fires dragleave; only clear when leaving the column.
        onDragLeave={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node | null) && setDropAt(null)}
        onDrop={(ev) => {
          const id = Number(ev.dataTransfer.getData("application/x-trip-idea"));
          const idea = ideas.find((i) => i.id === id);
          setDropAt(null);
          if (!idea) return;
          ev.preventDefault();
          let day = d;
          let h = hourAt(d, ev.clientY);
          // Dropped on a calendar shown in another zone: store it in the trip's zone.
          if (converting) {
            const c = wallClock(instantOf(`${d}T${hhmm(h)}`, viewTz), tripTz);
            day = c.date;
            h = c.hour + Math.floor(c.minute / 15) * STEP;
          }
          setDraft({ ...emptyDraft(day, h, Math.min(24, h + 1)), title: idea.text, idea_id: idea.id });
        }}
        onPointerDown={(ev) => {
          if (!editing || ev.button !== 0) return;
          const h = hourAt(d, ev.clientY);
          pressThen(ev, ev.currentTarget, () => setDrag({ date: d, anchor: h, cur: h }));
        }}
        onPointerMove={(ev) => {
          if (hold.current) {
            if (Math.hypot(ev.clientX - hold.current.x, ev.clientY - hold.current.y) > HOLD_SLOP) endHold();
          } else if (drag && drag.date === d) {
            const h = hourAt(d, ev.clientY);
            if (h !== drag.cur) setDrag({ ...drag, cur: h });
          } else if (resize?.edge === "end") {
            const end = Math.max(resize.start + STEP, Math.min(24, edgeAt(d, ev.clientY)));
            if (end !== resize.end) setResize({ ...resize, end });
          } else if (resize) {
            const start = Math.min(resize.end - STEP, Math.max(0, edgeAt(d, ev.clientY)));
            if (start !== resize.start) setResize({ ...resize, start });
          }
        }}
        // The browser took the touch over (e.g. it began scrolling): drop the half-made gesture.
        onPointerCancel={() => {
          endHold();
          gesture.current = false;
          setDrag(null);
          setResize(null);
        }}
        onPointerUp={() => {
          endHold();
          gesture.current = false;
          if (drag && drag.date === d) {
            const a = Math.min(drag.anchor, drag.cur);
            const b = Math.max(drag.anchor, drag.cur) + STEP;
            setDrag(null);
            setDraft(emptyDraft(d, a, b));
          } else if (resize) {
            const r = resize;
            setResize(null);
            const e = events.find((x) => x.id === r.id);
            if (e && (e.start_hour !== r.start || e.end_hour !== r.end))
              run(() => api(`events/${r.id}`, "PUT", { ...e, trip_id: trip.id, start_hour: r.start, end_hour: r.end }));
          }
        }}
      >
        {hours.map((h) => (
          <div key={h} className="border-t border-line/60" style={{ height: row }}>
            {row >= 64 ? (
              // Zoomed in far enough to show quarter-hour lines too.
              <>
                <div className="h-1/4 border-b border-dotted border-line/30" />
                <div className="h-1/4 border-b border-dashed border-line/40" />
                <div className="h-1/4 border-b border-dotted border-line/30" />
              </>
            ) : (
              <div className="h-1/2 border-b border-dashed border-line/40" />
            )}
          </div>
        ))}
        {dropAt?.date === d && (
          <div
            className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-accent bg-accent-dim/60 px-2 py-0.5 text-[11px] text-prose"
            style={{ top: (dropAt.hour - from) * row + 1, height: row - 2 }}
          >
            Drop at {timeLabel(dropAt.hour)}
          </div>
        )}
        {sel && (
          <div
            className="pointer-events-none absolute inset-x-1 rounded border-2 border-dashed border-accent bg-accent/25 px-1.5 py-1 text-xs text-prose"
            style={{ top: (sel.a - from) * row + 1, height: (sel.b - sel.a) * row - 2 }}
          >
            {timeLabel(sel.a)}–{timeLabel(sel.b)} · {lengthLabel(sel.b - sel.a)}
          </div>
        )}
        {placed.map(({ e, lane, lanes }) => {
          const sized = resize && resize.id === e.id && !e.seg ? resize : null;
          const start = sized ? sized.start : e.start_hour;
          const end = sized ? sized.end : e.end_hour;
          if (end <= from || start >= to) return null;
          const s = STATUS[e.status] ?? STATUS.none;
          const top = (Math.max(start, from) - from) * row;
          const height = (Math.min(end, to) - Math.max(start, from)) * row;
          const hasLinks = LINKS.some((l) => e[l.key]);
          const seg = e.seg;
          return (
            <div
              key={seg ? `${e.id}-${seg.flight.id}-${seg.part}` : e.id}
              role="button"
              tabIndex={0}
              onPointerDown={(ev) => ev.stopPropagation()}
              // A flight block is a slice of its event: open the event itself.
              onClick={() => openEvent(e.id)}
              onKeyDown={(ev) => ev.key === "Enter" && openEvent(e.id)}
              title={
                seg
                  ? `${personName(seg.flight.person_id)}: ${seg.flight.from_code} ${timeOf(seg.flight.depart)} → ${seg.flight.to_code} ${timeOf(seg.flight.arrive)}${dayShift(seg.flight)} (local times) · ${e.title}`
                  : [e.title, e.location].filter(Boolean).join(" · ")
              }
              className={`absolute flex cursor-pointer flex-col justify-start overflow-hidden rounded-md px-2 py-1 text-left leading-snug shadow-sm transition-[filter] [overflow-wrap:anywhere] hover:brightness-95 ${
                phone && !editing ? "text-[13px]" : "text-xs"
              }`}
              style={{
                top: top + 1,
                height: Math.max(height - 2, 16),
                left: `calc(${(lane / lanes) * 100}% + 2px)`,
                width: `calc(${100 / lanes}% - 4px)`,
                background: s.bg,
                color: s.fg,
              }}
            >
              {seg ? (
                flightBlock(seg, height > row * 0.9)
              ) : height > row ? (
                <>
                  <span className="text-[11px] opacity-70">
                    {timeLabel(start)}–{timeLabel(end)}
                    {hasLinks && " · 🔗"}
                  </span>
                  <span>{e.title}</span>
                  {e.location && <span className="truncate text-[11px] opacity-80">📍 {e.location}</span>}
                </>
              ) : (
                // One-hour blocks: time and title share a line so the title isn't cut off.
                <span className="truncate">
                  <span className="opacity-70">{timeLabel(start)}{hasLinks && " 🔗"} · </span>
                  {e.title}
                </span>
              )}
              {editing && !seg && (
                // Grab the top edge to change when it starts, the bottom edge to change when it ends.
                <>
                  <span
                    aria-label="Drag to change the start"
                    onPointerDown={(ev) => startResize(ev, d, { id: e.id, edge: "start", start: e.start_hour, end: e.end_hour })}
                    onClick={(ev) => ev.stopPropagation()}
                    className={`absolute inset-x-0 top-0 cursor-ns-resize hover:bg-black/15 ${height < 24 ? "h-1" : "h-2"}`}
                  />
                  <span
                    aria-label="Drag to change the end"
                    onPointerDown={(ev) => startResize(ev, d, { id: e.id, edge: "end", start: e.start_hour, end: e.end_hour })}
                    onClick={(ev) => ev.stopPropagation()}
                    className={`absolute inset-x-0 bottom-0 cursor-ns-resize hover:bg-black/15 ${height < 24 ? "h-1" : "h-2"}`}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /** The hour labels beside a column. */
  const hourGutter = (
    <div>
      {hours.map((h) => (
        <div key={h} className="pr-2 pt-0.5 text-right text-[11px] text-faint" style={{ height: row }}>
          {hourLabel(h)}
        </div>
      ))}
    </div>
  );

  /**
   * A day's forecast: "🌦️ Drizzle · 61° / 44° · 30% rain" over "☀ 6:58 AM – 6:05 PM",
   * or when the forecast will be available.
   */
  function weatherLine(date: string) {
    const w = weather?.days[date];
    if (!w) return null;
    if (w.later) return <span title={`Forecast for ${w.place}`}>forecast from {shortDate(w.later)}</span>;
    if (!w.weather) return null;
    const x = w.weather;
    const look = weatherLook(x.code);
    return (
      <span title={`Forecast for ${w.place}`} className="flex flex-col">
        <span>
          {look.icon} <span className="text-subtle">{look.label}</span> · {x.max}° / {x.min}°
          {x.rain != null && x.rain >= 20 ? ` · ${x.rain}% rain` : ""}
        </span>
        {x.sunrise && x.sunset && (
          <span>
            <span aria-label="sunrise">↑</span> {clock(x.sunrise)} · <span aria-label="sunset">↓</span> {clock(x.sunset)}
          </span>
        )}
      </span>
    );
  }

  type DaySection = "stay" | "car" | "notes" | "meals";
  const SECTION_LABEL: Record<DaySection, string> = { stay: "Stay", car: "Car", notes: "Notes", meals: "Meals" };

  /** Which of a day's sections have anything in them. */
  function filled(info: TripDay): Record<DaySection, boolean> {
    return {
      stay: !!(info.accommodation || info.stay_address || info.cancel_by || info.non_refundable || info.stay_link),
      car: !!(info.car || info.car_cancel_by || info.car_non_refundable || info.car_link || info.car_notes),
      notes: !!info.notes,
      meals: MEALS.some((m) => info[m.key]),
    };
  }

  /** A pill for a stay or car: amber "Confirm" until booked, green "✓ Confirmed" (or just ✓ when short) after; click to switch. */
  function confirmMark(date: string, field: "accommodation_status" | "car_status", short = false) {
    const info = dayInfo.get(date) ?? blankDay(date);
    const on = isConfirmed(info[field]);
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => saveDay(date, { [field]: on ? "" : "CONFIRMED" })}
        title={on ? "Confirmed — click to unmark" : "Not confirmed yet — click once it's booked"}
        aria-pressed={on}
        className="ml-1.5 shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium normal-case leading-tight tracking-normal transition hover:opacity-80"
        style={on ? { background: GREEN, borderColor: GREEN, color: "#fff" } : { borderColor: AMBER, color: AMBER }}
      >
        {on ? (short ? "✓" : "✓ Confirmed") : "Confirm"}
      </button>
    );
  }

  /** "cancel by Oct 13 · tomorrow", "non-refundable", or nothing. */
  function cancelShort(info: TripDay, car = false) {
    const nonRefundable = car ? info.car_non_refundable : info.non_refundable;
    const cancelBy = car ? info.car_cancel_by : info.cancel_by;
    if (nonRefundable) return <span style={{ color: RED }}>non-refundable</span>;
    if (!cancelBy) return null;
    const d = deadline(cancelBy, today);
    return d.passed ? (
      <span className="text-faint">free cancellation ended</span>
    ) : (
      <span className="text-faint">
        cancel by {shortDate(cancelBy)} <span style={{ color: d.color }}>· {d.text}</span>
      </span>
    );
  }

  /** The cancel-by date and non-refundable box, shared by stay and car in Edit. */
  function cancelFields(date: string, info: TripDay, car: boolean) {
    const byKey = car ? "car_cancel_by" : "cancel_by";
    const nrKey = car ? "car_non_refundable" : "non_refundable";
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/*
          Saved when the box is left (or Enter), not per keystroke: while the year is typed the
          box briefly holds dates like 0002-10-13, and saving those scrambled the year.
        */}
        {/* In a narrow day column (phones) the date box drops below "cancel by" instead of spilling into the next day. */}
        <label className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-faint">
          <span className="whitespace-nowrap">cancel by</span>
          <input
            key={`${byKey}-${info[byKey]}`}
            type="date"
            defaultValue={info[byKey]}
            disabled={info[nrKey]}
            max={date}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== info[byKey] && (v === "" || v >= "2000-01-01")) saveDay(date, { [byKey]: v });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={`${inputCls} w-[8.5rem] min-w-0 max-w-full px-1.5 py-0.5 text-xs disabled:opacity-40`}
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-subtle">
          <input
            type="checkbox"
            checked={info[nrKey]}
            disabled={busy}
            onChange={(e) => saveDay(date, { [nrKey]: e.target.checked, ...(e.target.checked ? { [byKey]: "" } : {}) })}
          />
          non-refundable
        </label>
      </div>
    );
  }

  const dayHasDetails = (d: string) => Object.values(filled(dayInfo.get(d) ?? blankDay(d))).some(Boolean);
  const anyDayDetails = dates.some(dayHasDetails);

  /**
   * A day's stay, car rental, notes and meals. Edit shows only the sections in
   * use, with "+ Stay"-style buttons for the rest; View shows only what's filled.
   */
  function dayDetails(date: string, stacked = false) {
    const info = dayInfo.get(date) ?? blankDay(date);
    const has = filled(info);
    const meals = MEALS.filter((m) => info[m.key]);
    const head = "text-[11px] uppercase tracking-wide text-faint";
    const field = `${inputCls} w-full py-1 text-xs`;

    if (editing) {
      const isOpen = (k: DaySection) => has[k] || openSections.has(`${date}|${k}`);
      // Opened from its "+" button (still empty): focus its first box.
      const fresh = (k: DaySection) => !has[k] && openSections.has(`${date}|${k}`);
      const closed = (["stay", "car", "notes", "meals"] as DaySection[]).filter((k) => !isOpen(k));
      return (
        <div className="flex flex-col gap-1.5 text-xs">
          {isOpen("stay") && (
            <>
              <span className={`flex items-center ${head}`}>
                Stay
                {confirmMark(date, "accommodation_status")}
              </span>
              <div className="flex items-center">
                <input
                  key={`a-${info.accommodation}`}
                  autoFocus={fresh("stay")}
                  defaultValue={info.accommodation}
                  placeholder="Where you're staying"
                  onBlur={(e) => e.target.value !== info.accommodation && saveDay(date, { accommodation: e.target.value })}
                  className={field}
                />
              </div>
              <StayAddress
                key={`s-${info.stay_address}`}
                saved={info.stay_address}
                tripId={trip.id}
                className={field}
                onSave={(stay_address) => saveDay(date, { stay_address })}
              />
              {cancelFields(date, info, false)}
              <input
                key={`l-${info.stay_link}`}
                type="url"
                defaultValue={info.stay_link}
                placeholder="Booking link"
                onBlur={(e) => e.target.value !== info.stay_link && saveDay(date, { stay_link: e.target.value.trim() })}
                className={field}
              />
            </>
          )}
          {isOpen("car") && (
            <>
              <span className={`mt-1 flex items-center ${head}`}>
                Car rental
                {confirmMark(date, "car_status")}
              </span>
              <div className="flex items-center">
                <input
                  key={`car-${info.car}`}
                  autoFocus={fresh("car")}
                  defaultValue={info.car}
                  placeholder="Rental company"
                  onBlur={(e) => e.target.value !== info.car && saveDay(date, { car: e.target.value })}
                  className={field}
                />
              </div>
              {cancelFields(date, info, true)}
              <input
                key={`cl-${info.car_link}`}
                type="url"
                defaultValue={info.car_link}
                placeholder="Booking link"
                onBlur={(e) => e.target.value !== info.car_link && saveDay(date, { car_link: e.target.value.trim() })}
                className={field}
              />
              <textarea
                key={`cn-${info.car_notes}`}
                defaultValue={info.car_notes}
                placeholder="Pickup location, confirmation #, car…"
                rows={2}
                onBlur={(e) => e.target.value !== info.car_notes && saveDay(date, { car_notes: e.target.value })}
                className={`${field} resize-y`}
              />
            </>
          )}
          {isOpen("notes") && (
            <>
              <span className={`mt-1 ${head}`}>Notes</span>
              <textarea
                key={`n-${info.notes}`}
                autoFocus={fresh("notes")}
                defaultValue={info.notes}
                placeholder="Anything else for the day"
                rows={2}
                onBlur={(e) => e.target.value !== info.notes && saveDay(date, { notes: e.target.value })}
                className={`${field} resize-y`}
              />
            </>
          )}
          {isOpen("meals") && (
            <>
              <span className={`mt-1 ${head}`}>Meals</span>
              {MEALS.map((m, i) => (
                <input
                  key={`${m.key}-${info[m.key]}`}
                  autoFocus={fresh("meals") && i === 0}
                  defaultValue={info[m.key]}
                  placeholder={m.label}
                  onBlur={(e) => e.target.value !== info[m.key] && saveDay(date, { [m.key]: e.target.value })}
                  className={field}
                />
              ))}
            </>
          )}
          {closed.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {closed.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setOpenSections(new Set(openSections).add(`${date}|${k}`))}
                  className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-faint transition-colors hover:border-accent hover:text-prose"
                >
                  + {SECTION_LABEL[k]}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (!has.stay && !has.car && !has.notes && !has.meals) return null;
    const link = (href: string) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="ml-1 shrink-0 text-faint hover:text-prose" title="Booking link">
        🔗
      </a>
    );
    return (
      <div className={`flex flex-col gap-2 ${stacked ? "text-sm" : "text-xs"}`}>
        {has.stay && (
          <div className="flex flex-col">
            <span className="flex min-w-0 items-center">
              <span className="mr-1" aria-label="Stay">🏨</span>
              <span className="truncate text-prose" title={info.accommodation}>
                {info.accommodation || "Stay"}
              </span>
              {info.accommodation && confirmMark(date, "accommodation_status", true)}
              {info.stay_link && link(info.stay_link)}
            </span>
            {info.stay_address && (
              <span className="truncate pl-5 text-faint" title={info.stay_address}>
                📍 {info.stay_address}
              </span>
            )}
            <span className="pl-5">{cancelShort(info)}</span>
          </div>
        )}
        {has.car && (
          <div className="flex flex-col">
            <span className="flex min-w-0 items-center">
              <span className="mr-1" aria-label="Car rental">🚗</span>
              <span className="truncate text-prose" title={info.car}>
                {info.car || "Rental car"}
              </span>
              {info.car && confirmMark(date, "car_status", true)}
              {info.car_link && link(info.car_link)}
            </span>
            <span className="pl-5">{cancelShort(info, true)}</span>
            {info.car_notes && (
              <p className="whitespace-pre-wrap pl-5 text-subtle">
                <Linkified text={info.car_notes} />
              </p>
            )}
          </div>
        )}
        {has.notes && (
          <p className="whitespace-pre-wrap text-subtle">
            <span className="mr-1" aria-label="Notes">📝</span>
            <Linkified text={info.notes} />
          </p>
        )}
        {has.meals && (
          <div className="flex flex-col">
            {meals.map((m) => (
              <span key={m.key} className="text-subtle">
                <span className="text-faint">{m.label}:</span> {info[m.key]}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  /**
   * The ⋯ menu: everything that isn't the calendar itself — which time zone to
   * show, calendar export, and the trip's settings.
   */
  function tripMenu() {
    // The feed URL carries the trip's calendar token: calendar apps can't sign in.
    const feed = `${window.location.host}/api/trips/${trip.id}/calendar.ics?token=${calendarToken}`;
    const head = "px-3 pb-1 pt-2.5 text-[10px] uppercase tracking-wider text-faint";
    const row = "flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-prose transition-colors hover:bg-lift";
    const close = () => setMenu(false);
    return (
      <>
        {/* Click anywhere else to close. */}
        <div className="fixed inset-0 z-20" onClick={close} />
        <div className="absolute right-0 z-30 mt-1 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          {tripTz && !editing && (
            <>
              <p className={head}>Show times in</p>
              <div className="px-3 pb-1">
                <select
                  value={zoneChoice === "local" || zoneChoice === "trip" ? zoneChoice : viewTz}
                  onChange={(e) => setZoneChoice(e.target.value)}
                  className={`${inputCls} w-full py-1 text-xs`}
                  aria-label="Time zone to show times in"
                >
                  <option value="local">Your time{deviceTz ? ` (${tzLabel(deviceTz).replace(" time", "")})` : ""}</option>
                  <option value="trip">Trip time ({tzLabel(tripTz).replace(" time", "")})</option>
                  {/* The full list only once in the browser, so the server and first client render agree. */}
                  {deviceTz && (
                    <optgroup label="Other time zones">
                      {Intl.supportedValuesOf("timeZone").map((z) => (
                        <option key={z} value={z}>
                          {z.replace(/_/g, " ")}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </>
          )}

          <p className={head}>Add to calendar</p>
          {/* Google's subscribe link takes the feed as webcal://; an https:// one can fail with "Unable to add calendar". */}
          <a className={row} href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://${feed}`)}`} target="_blank" rel="noopener noreferrer" onClick={close}>
            Google Calendar
          </a>
          <a className={row} href={`webcal://${feed}`} onClick={close}>
            Apple Calendar
          </a>
          <a className={row} href={`/api/trips/${trip.id}/calendar.ics?download`} onClick={close}>
            Download .ics
          </a>
          <p className="px-3 pb-1 text-[11px] leading-snug text-faint">Keeps in sync with changes. Anyone with the link can see the itinerary.</p>

          <p className={head}>Trip</p>
          <button
            className={row}
            onClick={() => {
              setEditTrip(true);
              close();
            }}
          >
            Rename, dates & time zone
          </button>
          {!trip.time_zone && weather?.timezone && (
            <button className={row} title="Taken from where this trip's events are" onClick={() => run(() => putTrip({ time_zone: weather.timezone }))}>
              Set time zone to {tzLabel(weather.timezone)}
            </button>
          )}
          <label className={row}>
            <input type="checkbox" checked={trip.done} onChange={(e) => run(() => putTrip({ done: e.target.checked }))} />
            Trip done
          </label>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-xs text-subtle">
            View hours
            <select
              value={trip.view_start_hour ?? ""}
              onChange={(e) => run(() => putTrip({ view_start_hour: e.target.value === "" ? null : Number(e.target.value) }))}
              className={`${inputCls} py-0.5 text-xs`}
              aria-label="View mode starts at"
            >
              <option value="">auto</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            to
            <select
              value={trip.view_end_hour ?? ""}
              onChange={(e) => run(() => putTrip({ view_end_hour: e.target.value === "" ? null : Number(e.target.value) }))}
              className={`${inputCls} py-0.5 text-xs`}
              aria-label="View mode ends at"
            >
              <option value="">auto</option>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h === 24 ? "midnight" : hourLabel(h)}
                </option>
              ))}
            </select>
          </div>
          <button
            className={`${row} text-red-400`}
            onClick={async () => {
              if (!confirm(`Delete "${trip.name}" and its whole calendar? Expenses stay in the budget, unlinked.`)) return;
              if (await run(() => api(`trips/${trip.id}`, "DELETE"))) router.push("/trips");
            }}
          >
            Delete trip
          </button>
          {editing && (
            <p className="border-t border-line px-3 pb-1 pt-2 text-[11px] leading-snug text-faint">
              Tip: drag down a day to add an event, drag an event&apos;s top or bottom edge to change its times, click one to edit.
            </p>
          )}
        </div>
      </>
    );
  }

  const phoneView = phone && !editing;
  const dayIdx = cols.indexOf(phoneDay);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {/* Title, mode switch, trip settings */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/trips" className="text-sm text-faint hover:text-prose">
          ← Trips
        </Link>
        {editTrip ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => putTrip(tripForm))) setEditTrip(false);
            }}
          >
            <input value={tripForm.name} onChange={(e) => setTripForm({ ...tripForm, name: e.target.value })} className={`${inputCls} w-64`} />
            <input type="date" value={tripForm.start_date} onChange={(e) => setTripForm({ ...tripForm, start_date: e.target.value })} className={inputCls} />
            <input type="date" min={tripForm.start_date} value={tripForm.end_date} onChange={(e) => setTripForm({ ...tripForm, end_date: e.target.value })} className={inputCls} />
            <select
              value={tripForm.time_zone}
              onChange={(e) => setTripForm({ ...tripForm, time_zone: e.target.value })}
              className={`${inputCls} max-w-56`}
              aria-label="Time zone"
            >
              <option value="">Time zone: not set</option>
              {Intl.supportedValuesOf("timeZone").map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button disabled={busy} className={btnCls}>
              Save
            </button>
            <button type="button" className={ghostCls} onClick={() => setEditTrip(false)}>
              cancel
            </button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-4">
            <h1 className="text-xl font-medium text-prose">{trip.name}</h1>
            <span className="text-sm text-faint">
              {dayLabel(trip.start_date)} – {dayLabel(trip.end_date)} · {dates.length} days
              {tripTz && editing && <span title="Times are entered in the trip's time zone"> · {tzLabel(tripTz)}</span>}
              {trip.done && <span className="ml-2 text-[#17a06b]">✓ done</span>}
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded border border-line text-sm leading-none text-subtle" role="group" aria-label="Calendar zoom">
            <button
              onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
              disabled={zoom === ZOOMS[0]}
              aria-label="Zoom out"
              title="Zoom out"
              className="px-2.5 py-1.5 transition-colors hover:text-prose disabled:opacity-30"
            >
              −
            </button>
            <button
              onClick={() => setZoom(1)}
              title="Reset zoom"
              className="min-w-10 px-1 py-1.5 text-center text-xs tabular-nums transition-colors hover:text-prose"
            >
              {zoom}×
            </button>
            <button
              onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
              disabled={zoom === ZOOMS[ZOOMS.length - 1]}
              aria-label="Zoom in"
              title="Zoom in"
              className="px-2.5 py-1.5 transition-colors hover:text-prose disabled:opacity-30"
            >
              +
            </button>
          </div>
          <div className="flex rounded border border-line p-0.5">
            {(["view", "edit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setDraft(null);
                  setViewing(null);
                }}
                className={`rounded px-3 py-1 text-sm capitalize transition-colors ${mode === m ? "bg-lift text-prose" : "text-faint hover:text-subtle"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              onClick={() => setMenu(!menu)}
              aria-expanded={menu}
              aria-label="Trip options"
              className="rounded border border-line px-2.5 py-1 text-sm leading-none text-subtle transition-colors hover:text-prose"
            >
              ⋯
            </button>
            {menu && tripMenu()}
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
        {(Object.keys(STATUS) as EventStatus[])
          .filter((k) => k !== "none")
          .map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: STATUS[k].bg }} />
              {STATUS[k].label}
            </span>
          ))}
        {converting && (
          <span className="text-[#e0a63a]">
            · Shown in {tzLabel(viewTz)} — planned in {tzLabel(tripTz)}
          </span>
        )}
        {weather && !weather.located && dates[dates.length - 1] >= today && (
          <span className="text-faint">· 🌤 Add a 📍 location to an event to see the weather</span>
        )}
      </div>

      <div ref={calendarRef} className="scroll-mt-4">
      {phoneView ? (
        /* Phone, view mode: one day at a time */
        <div className="flex flex-col gap-3">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
            {cols.map((d) => (
              <button
                key={d}
                onClick={() => setPhoneDay(d)}
                className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  d === phoneDay ? "border-accent bg-accent-dim text-prose" : "border-line text-faint"
                }`}
              >
                <span>{new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className="text-base text-prose">{new Date(d + "T00:00:00").getDate()}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button className="px-2 py-1 text-2xl text-faint disabled:opacity-30" disabled={dayIdx <= 0} onClick={() => setPhoneDay(cols[dayIdx - 1])} aria-label="Previous day">
              ‹
            </button>
            <h2 className="text-center text-base font-medium text-prose">
              {dayLabel(phoneDay, true)}
              <span className="block text-xs font-normal text-faint">
                {dates.includes(phoneDay) ? `day ${dates.indexOf(phoneDay) + 1} of ${dates.length}` : "outside the trip (time zone shift)"}
              </span>
              <span className="block text-xs font-normal text-faint">{weatherLine(phoneDay)}</span>
            </h2>
            <button
              className="px-2 py-1 text-2xl text-faint disabled:opacity-30"
              disabled={dayIdx >= cols.length - 1}
              onClick={() => setPhoneDay(cols[dayIdx + 1])}
              aria-label="Next day"
            >
              ›
            </button>
          </div>
          {dates.includes(phoneDay) && dayHasDetails(phoneDay) && (
            <div className="rounded-lg border border-line bg-surface p-3">{dayDetails(phoneDay, true)}</div>
          )}
          <div className="grid rounded-lg border border-line bg-surface py-1 pr-2" style={{ gridTemplateColumns: "52px minmax(0, 1fr)" }}>
            {hourGutter}
            {dayColumn(phoneDay)}
          </div>
        </div>
      ) : (
        /* Desktop (and editing on any screen): every day side by side */
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(${editing ? 150 : 140}px, 1fr))` }}>
            <div className="sticky left-0 z-10 border-b border-line bg-surface" />
            {cols.map((d) => (
              <div key={d} className="border-b border-l border-line px-2 py-2 text-center text-xs text-subtle">
                {dayLabel(d)}
                <span className="mt-0.5 block min-h-4 text-[11px] leading-snug text-faint">{weatherLine(d)}</span>
              </div>
            ))}
            <div className="sticky left-0 z-10 bg-surface">{hourGutter}</div>
            {cols.map((d) => (
              <div key={d} className="border-l border-line">
                {dayColumn(d)}
              </div>
            ))}
            {/* Day details row: always in Edit; in View only when some day has something. */}
            {(editing || anyDayDetails) && (
              <>
                <div className="sticky left-0 z-10 border-t border-line bg-surface" />
                {cols.map((d) => (
                  <div key={d} className="border-l border-t border-line p-2">
                    {dates.includes(d) ? dayDetails(d) : null}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      </div>
      {outside > 0 && (
        <p className="text-xs text-[#c98500]">
          {outside} event{outside === 1 ? "" : "s"} fall outside the trip&apos;s dates and aren&apos;t shown — widen the dates to see them.
        </p>
      )}

      {/* Where the events are, and the roads between them */}
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className={`flex items-baseline justify-between gap-2 ${trip.hide_map ? "" : "mb-3"}`}>
          <h2 className="text-sm font-medium text-subtle">Map{trip.hide_map && <span className="font-normal text-faint"> · off</span>}</h2>
          <button className={ghostCls} disabled={busy} onClick={() => run(() => putTrip({ hide_map: !trip.hide_map }))}>
            {trip.hide_map ? "turn on map" : "turn off map"}
          </button>
        </div>
        {!trip.hide_map && (
          <>
            <TripMap tripId={trip.id} dates={dates} />
            <label className="mt-3 flex w-fit items-center gap-2 text-xs text-subtle">
              <input type="checkbox" checked={trip.show_route} disabled={busy} onChange={(e) => run(() => putTrip({ show_route: e.target.checked }))} />
              Show this route on the Trips page map
            </label>
          </>
        )}
      </section>

      {/* Ideas: one line each; drag onto the calendar to schedule */}
      <IdeasList
        ideas={ideas}
        tripId={trip.id}
        busy={busy}
        run={run}
        // The list sits below the calendar: bring the calendar into view as soon as a drag starts.
        onDragStart={() => setTimeout(() => calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30)}
        onSchedule={(idea) => setDraft({ ...emptyDraft(dates.includes(phoneDay) ? phoneDay : dates[0], 10, 11), title: idea.text, idea_id: idea.id })} />

      <div>
        {/* Expenses for this trip (they also count in the budget). Empty in View: one quiet line. */}
        {!editing && expenses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-2.5 text-sm text-faint">
            Expenses · none yet <span className="text-xs">— add them in Edit</span>
          </p>
        ) : (
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-subtle">Expenses</h2>
            <span className="text-xs tabular-nums text-faint">{usd(spent)} · counts toward the budget</span>
          </div>
          <ul className="flex flex-col">
            {expenses.map((x) => (
              <li key={x.id} className="flex items-baseline gap-2 border-t border-line py-1.5 text-sm">
                <span className="font-semibold text-prose" title="The month this expense counts toward">
                  {shortMonth(x.month)}
                </span>
                <span className="text-prose">{x.person_name}</span>
                <span className="text-xs text-faint">
                  {x.category} · {x.kind}
                </span>
                <span className="truncate text-xs text-faint">
                  {routeLabel(x) && <span className="mr-1 text-subtle">✈ {routeLabel(x)}</span>}
                  {x.notes}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-faint" title="The day this expense was logged">
                  {loggedDay(x.created_at) && `logged ${loggedDay(x.created_at)}`}
                </span>
                <span className="tabular-nums text-prose">{usd(x.amount)}</span>
                {editing && (
                  <button className={`${ghostCls} hover:text-red-400`} onClick={() => confirm("Delete this expense?") && run(() => api(`expenses/${x.id}`, "DELETE"))}>
                    delete
                  </button>
                )}
              </li>
            ))}
            {expenses.length === 0 && <li className="text-sm text-faint">None yet.</li>}
          </ul>
          {editing && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run(() =>
                  api("expenses", "POST", {
                    ...xForm,
                    ...flightPayload(isFlight(xForm.category), xFlight),
                    category: xForm.category.trim() || "Other",
                    trip_id: trip.id,
                  })
                );
                if (ok) {
                  setXForm({ ...xForm, amount: "", notes: "" });
                  setXFlight(emptyFlight);
                }
              }}
            >
              <select value={xForm.person_id} onChange={(e) => setXForm({ ...xForm, person_id: Number(e.target.value) })} className={inputCls}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input type="month" value={xForm.month} onChange={(e) => setXForm({ ...xForm, month: e.target.value })} className={inputCls} />
              <input list="trip-expense-categories" placeholder="Type (e.g. Hotels)" value={xForm.category} onChange={(e) => setXForm({ ...xForm, category: e.target.value })} className={`${inputCls} w-36`} />
              <datalist id="trip-expense-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <select value={xForm.kind} onChange={(e) => setXForm({ ...xForm, kind: e.target.value })} className={inputCls}>
                <option value="travel">Travel</option>
                <option value="visiting">Visiting</option>
              </select>
              <input required type="number" step="0.01" placeholder="Amount" value={xForm.amount} onChange={(e) => setXForm({ ...xForm, amount: e.target.value })} className={`${inputCls} w-24`} />
              <input placeholder="Notes" value={xForm.notes} onChange={(e) => setXForm({ ...xForm, notes: e.target.value })} className={`${inputCls} flex-1`} />
              {isFlight(xForm.category) && <FlightFields name="trip-flight" value={xFlight} onChange={setXFlight} required />}
              <button disabled={busy} className={btnCls}>
                Add
              </button>
            </form>
          )}
        </section>
        )}
      </div>

      {/* What's still expected to be spent (not counted in the budget) */}
      <EstimatedExpenses
        estimates={estimates}
        tripId={trip.id}
        spent={spent}
        editing={editing}
        busy={busy}
        run={run}
        categories={categories}
      />

      {/* The trip's living doc */}
      <TripDoc tripId={trip.id} doc={trip.doc} onSaved={() => router.refresh()} />

      {/* View mode: event details (a bottom sheet on phones) */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setViewing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 pb-8 sm:max-w-md sm:rounded-lg sm:pb-5"
          >
            <div className="mx-auto -mt-2 mb-1 h-1 w-10 rounded-full bg-line sm:hidden" />
            <div className="flex items-start gap-3">
              <span className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: STATUS[viewing.status].bg }} />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium leading-snug text-prose [overflow-wrap:anywhere]">{viewing.title}</h3>
                <p className="mt-0.5 text-xs text-faint">
                  {dayLabel(viewing.date)}
                  {/* Flights carry their own times below; the event's stored span would only mislead. */}
                  {!viewing.flights.length && ` · ${viewingTimes(viewing)}`}
                  {viewing.status !== "none" && ` · ${STATUS[viewing.status].label}`}
                </p>
                {viewing.location && (
                  <a
                    href={viewing.map_link || mapsSearch(viewing.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-sm text-subtle underline decoration-line underline-offset-2 hover:text-prose [overflow-wrap:anywhere]"
                  >
                    📍 {viewing.location}
                  </a>
                )}
              </div>
              <button className={`${ghostCls} p-1 text-base`} onClick={() => setViewing(null)} aria-label="Close">
                ✕
              </button>
            </div>
            {viewing.flights.length > 0 && (
              <ul className="flex flex-col gap-2">
                {viewing.flights.map((f) => (
                  <li key={f.id} className="rounded-lg border border-line bg-lift/40 px-3 py-2 text-sm">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-prose">
                        ✈ {personName(f.person_id)}
                        {f.flight_no && (
                          <>
                            <span className="text-faint"> · {f.flight_no}</span>
                            <a
                              href={`https://www.flightaware.com/live/flight/${encodeURIComponent(f.flight_no.replace(/\s+/g, "").toUpperCase())}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1.5 text-xs text-accent hover:underline"
                              title="Live status, gate and delays on FlightAware"
                            >
                              live status ↗
                            </a>
                          </>
                        )}
                      </span>
                      <span className="text-xs text-faint">{flightLength(f)}</span>
                    </span>
                    <span className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-subtle">
                      <span className="font-medium text-prose">{f.from_code}</span>
                      <span>
                        {f.from_city} · departs {timeOf(f.depart)} {zoneAbbr(f.depart, f.from_tz)}
                      </span>
                      <span className="font-medium text-prose">{f.to_code}</span>
                      <span>
                        {f.to_city} · arrives {timeOf(f.arrive)} {zoneAbbr(f.arrive, f.to_tz)}
                        {dayShift(f) && <span className="text-[#e0a63a]"> (next day)</span>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {viewing.notes && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-subtle">
                <Linkified text={viewing.notes} />
              </p>
            )}
            {LINKS.some((l) => viewing[l.key]) && (
              <div className="flex flex-wrap gap-2">
                {LINKS.filter((l) => viewing[l.key]).map((l) => (
                  <a
                    key={l.key}
                    href={viewing[l.key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg border border-line bg-lift px-3 py-2.5 text-center text-sm text-prose transition-colors hover:border-accent sm:flex-none sm:py-1.5"
                  >
                    {l.icon} {l.label}
                  </a>
                ))}
              </div>
            )}
            {!viewing.notes && !viewing.location && !viewing.flights.length && !LINKS.some((l) => viewing[l.key]) && <p className="text-sm text-faint">No details yet.</p>}
            <div className="flex justify-end border-t border-line pt-3">
              <button className={ghostCls} onClick={() => openEditor(viewing)}>
                edit this event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit mode: event editor */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDraft(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              saveEvent();
            }}
            className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-surface p-5"
          >
            <h3 className="text-sm font-medium text-prose">{draft.id ? "Edit event" : "New event"}</h3>
            <input autoFocus required placeholder="What's happening?" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} />
            <LocationInput value={draft.location} onChange={(location) => setDraft({ ...draft, location })} tripId={trip.id} />
            <div className="flex flex-wrap gap-2">
              <select value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputCls}>
                {[...new Set([...dates, draft.date])].map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
              <select
                value={draft.start_hour}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setDraft({ ...draft, start_hour: s, end_hour: Math.max(draft.end_hour, s + STEP) });
                }}
                className={inputCls}
              >
                {SLOTS.map((h) => (
                  <option key={h} value={h}>
                    {timeLabel(h)}
                  </option>
                ))}
              </select>
              <span className="self-center text-faint">to</span>
              <select value={draft.end_hour} onChange={(e) => setDraft({ ...draft, end_hour: Number(e.target.value) })} className={inputCls}>
                {SLOTS.map((h) => h + STEP)
                  .filter((h) => h > draft.start_hour)
                  .map((h) => (
                    <option key={h} value={h}>
                      {h === 24 ? "12 AM (midnight)" : timeLabel(h)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
              Takes
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8].map((n) => {
                const on = draft.end_hour - draft.start_hour === n;
                return (
                  <button
                    type="button"
                    key={n}
                    disabled={draft.start_hour + n > 24}
                    onClick={() => setDraft({ ...draft, end_hour: draft.start_hour + n })}
                    className={`rounded border px-2 py-0.5 transition-colors disabled:opacity-30 ${on ? "border-accent bg-accent-dim text-prose" : "border-line hover:text-prose"}`}
                  >
                    {lengthLabel(n)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS) as EventStatus[]).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setDraft({ ...draft, status: k })}
                  className="rounded px-2 py-1 text-xs"
                  style={{
                    background: STATUS[k].bg,
                    color: STATUS[k].fg,
                    outline: draft.status === k ? "2px solid #deeade" : "none",
                    outlineOffset: 1,
                  }}
                >
                  {STATUS[k].label}
                </button>
              ))}
            </div>
            {draft.status === "transit" && (
              <FlightsEditor
                people={people}
                value={draft.flights ?? flightDrafts(people, [], draft.date, draft.start_hour, draft.end_hour)}
                onChange={(flights) => setDraft({ ...draft, flights })}
                tripZone={trip.time_zone}
              />
            )}
                        <textarea placeholder="Description (optional)" rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={inputCls} />
            {LINKS.map((l) => (
              <label key={l.key} className="flex items-center gap-2 text-xs text-faint">
                <span className="w-24 shrink-0">
                  {l.icon} {l.key === "other_link" ? "Other link" : `${l.label} link`}
                </span>
                <input type="url" placeholder="https://…" value={draft[l.key]} onChange={(e) => setDraft({ ...draft, [l.key]: e.target.value })} className={`${inputCls} flex-1`} />
              </label>
            ))}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex items-center gap-2">
              <button disabled={busy} className={btnCls}>
                {draft.id ? "Save" : "Add"}
              </button>
              <button type="button" className={ghostCls} onClick={() => setDraft(null)}>
                cancel
              </button>
              {draft.id && (
                <button
                  type="button"
                  className={`${ghostCls} ml-auto hover:text-red-400`}
                  onClick={async () => {
                    if (await run(() => api(`events/${draft.id}`, "DELETE"))) setDraft(null);
                  }}
                >
                  delete event
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * The trip's ideas, one line each. Drag a line onto the calendar (or tap
 * "schedule" on a phone) to turn it into an event; it leaves the list once
 * that event is saved.
 */
function IdeasList({
  ideas,
  tripId,
  busy,
  run,
  onSchedule,
  onDragStart,
}: {
  ideas: TripIdea[];
  tripId: number;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onSchedule: (idea: TripIdea) => void;
  onDragStart: () => void;
}) {
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await run(() => api("ideas", "POST", { trip_id: tripId, text: t }))) setText("");
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-subtle">Ideas</h2>
        <span className="text-xs text-faint">Drag one onto the calendar to schedule it</span>
      </div>
      <ul className="flex flex-col">
        {ideas.map((idea) => (
          <li
            key={idea.id}
            draggable={editingId !== idea.id}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-trip-idea", String(idea.id));
              e.dataTransfer.setData("text/plain", idea.text);
              e.dataTransfer.effectAllowed = "copy";
              onDragStart();
            }}
            className="group flex items-center gap-2 border-t border-line py-1.5 text-sm first:border-t-0"
          >
            <span className="cursor-grab select-none text-faint active:cursor-grabbing" aria-hidden>
              ⋮⋮
            </span>
            {editingId === idea.id ? (
              <input
                autoFocus
                defaultValue={idea.text}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  setEditingId(null);
                  if (t && t !== idea.text) run(() => api(`ideas/${idea.id}`, "PUT", { trip_id: tripId, text: t }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className={`${inputCls} flex-1 py-0.5`}
              />
            ) : (
              // A span, not a button: browsers won't start a drag from a button inside the row.
              <span
                role="button"
                tabIndex={0}
                className="min-w-0 flex-1 cursor-grab truncate text-prose"
                title="Click to edit · drag to schedule"
                onClick={() => setEditingId(idea.id)}
                onKeyDown={(e) => e.key === "Enter" && setEditingId(idea.id)}
              >
                {idea.text}
              </span>
            )}
            <button className={ghostCls} onClick={() => onSchedule(idea)}>
              schedule
            </button>
            <button
              className={`${ghostCls} hover:text-red-400`}
              aria-label={`Delete ${idea.text}`}
              onClick={() => run(() => api(`ideas/${idea.id}`, "DELETE"))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className={`flex gap-2 ${ideas.length ? "mt-3" : ""}`}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an idea — e.g. Sunset at the pier"
          maxLength={200}
          className={`${inputCls} flex-1`}
        />
        <button disabled={busy || !text.trim()} className={btnCls}>
          Add
        </button>
      </form>
    </section>
  );
}
