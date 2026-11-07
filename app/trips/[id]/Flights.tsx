"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Flight, Person } from "@/lib/queries";
import { instantOf, wallClock } from "@/lib/time";
import { inputCls } from "../../api";

// Flights on a transit event: one row per traveller, times as printed on the
// ticket (local to each airport). The server converts them to the trip's
// time zone and moves the event to fit.

export type FlightDraft = {
  person_id: number;
  on: boolean;
  flight_no: string;
  from_code: string;
  to_code: string;
  depart: string;
  arrive: string;
};

export function flightDrafts(people: Person[], flights: Flight[], date: string, start: number, end: number): FlightDraft[] {
  // Fractional hours (9.5) → "09:30".
  const hm = (h: number) => {
    const min = Math.min(23 * 60 + 59, Math.round(h * 60));
    return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  };
  return people.map((p) => {
    const f = flights.find((x) => x.person_id === p.id);
    return f
      ? { person_id: p.id, on: true, flight_no: f.flight_no, from_code: f.from_code, to_code: f.to_code, depart: f.depart, arrive: f.arrive }
      : { person_id: p.id, on: false, flight_no: "", from_code: "", to_code: "", depart: `${date}T${hm(start)}`, arrive: `${date}T${hm(end)}` };
  });
}

/** "2026-10-14T08:05" → "8:05 AM". */
export function timeOf(local: string): string {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The zone's short name at that local time, e.g. "PDT" or "GMT+9". */
export function zoneAbbr(local: string, tz: string): string {
  if (!tz) return "";
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(instantOf(local, tz))
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/** "5h 35m" door to door, across zones. */
export function flightLength(f: Flight): string {
  if (!f.from_tz || !f.to_tz) return "";
  const min = Math.round((instantOf(f.arrive, f.to_tz) - instantOf(f.depart, f.from_tz)) / 60_000);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

/** "+1" when the arrival's local date is after the departure's. */
export function dayShift(f: { depart: string; arrive: string }): string {
  const n = Math.round((Date.parse(f.arrive.slice(0, 10)) - Date.parse(f.depart.slice(0, 10))) / 86_400_000);
  return n > 0 ? ` +${n}` : n < 0 ? ` ${n}` : "";
}

type AirportHit = { code: string; name: string; city: string; country: string };

/** An airport code box that also searches by city or name ("boston" → BOS). */
function AirportInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [q, setQ] = useState(value);
  const [hits, setHits] = useState<AirportHit[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<AirportHit | null>(null);
  const listId = useId();
  const typed = useRef(false);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/airports?q=${encodeURIComponent(s)}`, { signal: ctrl.signal });
        const d = (await res.json()) as { airports: AirportHit[] };
        setHits(d.airports);
        // Show the matched airport's name under an exact code, typed or loaded.
        const exact = d.airports.find((a) => a.code === s.toUpperCase());
        setPicked(exact ?? null);
        if (exact && !typed.current) setOpen(false);
      } catch {
        // Aborted by the next keystroke.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  function choose(a: AirportHit) {
    typed.current = false;
    setQ(a.code);
    setPicked(a);
    onChange(a.code);
    setOpen(false);
  }

  return (
    <div className="relative w-28 shrink-0 sm:w-32">
      <input
        value={q}
        placeholder={label}
        onChange={(e) => {
          typed.current = true;
          setQ(e.target.value);
          setOpen(true);
          const v = e.target.value.trim().toUpperCase();
          onChange(/^[A-Z]{3}$/.test(v) ? v : "");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${inputCls} w-full uppercase placeholder:normal-case`}
        role="combobox"
        aria-label={label}
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        autoComplete="off"
      />
      <span className="mt-0.5 block truncate text-[10px] text-faint" title={picked?.name}>
        {picked ? `${picked.city || picked.name}` : q.trim().length >= 3 && !value ? "pick an airport" : ""}
      </span>
      {open && hits.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-lg">
          {hits.map((a) => (
            <li
              key={a.code}
              role="option"
              aria-selected={a.code === value}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
              className="cursor-pointer rounded px-2 py-1 text-sm hover:bg-lift"
            >
              <span className="font-medium text-prose">{a.code}</span> <span className="text-subtle">{a.city}</span>
              <span className="block truncate text-[11px] text-faint">
                {a.name}, {a.country}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The editor's Flights section: a row per traveller, switched on as needed. */
export function FlightsEditor({
  people,
  value,
  onChange,
  tripZone,
}: {
  people: Person[];
  value: FlightDraft[];
  onChange: (v: FlightDraft[]) => void;
  tripZone: string;
}) {
  const set = (i: number, patch: Partial<FlightDraft>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-3">
      <span className="text-xs font-medium text-subtle">✈ Flights</span>
      {value.map((f, i) => {
        const person = people.find((p) => p.id === f.person_id);
        return (
          <div key={f.person_id} className="flex flex-col gap-1.5">
            <label className="flex w-fit items-center gap-1.5 text-sm text-prose">
              <input
                type="checkbox"
                checked={f.on}
                onChange={(e) => {
                  // Travellers usually head to the same place: start from the other's airports.
                  const other = value.find((x) => x.on && x.person_id !== f.person_id);
                  set(i, { on: e.target.checked, ...(e.target.checked && other && !f.to_code ? { to_code: other.to_code } : {}) });
                }}
              />
              {person?.name ?? "Traveller"} is flying
            </label>
            {f.on && (
              <div className="flex flex-col gap-2 pl-5">
                <div className="flex flex-wrap items-start gap-2">
                  <AirportInput key={`from-${f.person_id}`} label="From" value={f.from_code} onChange={(v) => set(i, { from_code: v })} />
                  <span className="pt-1.5 text-faint">→</span>
                  <AirportInput key={`to-${f.person_id}`} label="To" value={f.to_code} onChange={(v) => set(i, { to_code: v })} />
                  <input
                    value={f.flight_no}
                    onChange={(e) => set(i, { flight_no: e.target.value })}
                    placeholder="Flight # (opt.)"
                    className={`${inputCls} w-32`}
                    aria-label="Flight number"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                  Departs
                  <input type="datetime-local" value={f.depart} onChange={(e) => set(i, { depart: e.target.value })} className={`${inputCls} py-1 text-xs`} />
                  Arrives
                  <input
                    type="datetime-local"
                    value={f.arrive}
                    min={f.depart}
                    onChange={(e) => set(i, { arrive: e.target.value })}
                    className={`${inputCls} py-1 text-xs`}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] leading-snug text-faint">
        Enter times as on the ticket — local to each airport. The calendar shows the flight in{" "}
        {tripZone ? `the trip's time zone (${tripZone.replace(/_/g, " ")})` : "the arrival airport's time zone (it becomes the trip's)"} and moves
        this event to fit.
      </p>
    </div>
  );
}

export type FlightSegment = { date: string; start: number; end: number; part: "whole" | "departs" | "arrives" };

/**
 * Where one flight sits on the calendar, in the trip's zone, to the minute
 * (hours as fractions). An overnight flight is split at midnight: a
 * "departs" piece and an "arrives" piece.
 */
export function flightSegments(f: Flight, tz: string): FlightSegment[] {
  if (!f.from_tz || !f.to_tz || !tz) return [];
  return spanSegments(instantOf(f.depart, f.from_tz), instantOf(f.arrive, f.to_tz), tz);
}

/**
 * A span between two instants as calendar pieces in `tz` (hours as
 * fractions), split at midnight: one "whole" piece, or "departs" and
 * "arrives" pieces either side of it.
 */
export function spanSegments(start: number, end: number, tz: string): FlightSegment[] {
  const a = wallClock(start, tz);
  const b = wallClock(end, tz);
  const at = (c: { hour: number; minute: number }) => c.hour + c.minute / 60;
  if (a.date === b.date) return [{ date: a.date, start: at(a), end: Math.max(at(b), at(a) + 0.25), part: "whole" }];
  return [
    { date: a.date, start: at(a), end: 24, part: "departs" },
    ...(at(b) > 0 ? [{ date: b.date, start: 0, end: Math.max(at(b), 0.25), part: "arrives" as const }] : []),
  ];
}
