"use client";

import { inputCls } from "./api";

export type FlightValue = { flight_from: string; flight_to: string; round_trip: string };

export const emptyFlight: FlightValue = { flight_from: "", flight_to: "", round_trip: "" };

/** The route fields shown for a flight expense; `required` on new expenses. */
export default function FlightFields({
  value,
  onChange,
  required,
  name,
}: {
  value: FlightValue;
  onChange: (v: FlightValue) => void;
  required: boolean;
  /** Unique per form, so each form's radio pair is its own group. */
  name: string;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded border border-dashed border-line px-2 py-1.5">
      <span className="text-xs text-faint">✈ Flight</span>
      <input
        required={required}
        placeholder="From (e.g. SFO)"
        value={value.flight_from}
        onChange={(e) => onChange({ ...value, flight_from: e.target.value })}
        className={`${inputCls} w-36`}
        aria-label="Flying from"
      />
      <span className="text-faint">→</span>
      <input
        required={required}
        placeholder="To (e.g. IAD)"
        value={value.flight_to}
        onChange={(e) => onChange({ ...value, flight_to: e.target.value })}
        className={`${inputCls} w-36`}
        aria-label="Flying to"
      />
      {[
        { v: "1", label: "Round trip" },
        { v: "0", label: "One way" },
      ].map((o) => (
        <label key={o.v} className="flex items-center gap-1 text-sm text-subtle">
          <input
            type="radio"
            name={name}
            required={required}
            checked={value.round_trip === o.v}
            onChange={() => onChange({ ...value, round_trip: o.v })}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** The flight columns to send for an expense: cleared when it isn't a flight. */
export function flightPayload(isFlight: boolean, v: FlightValue) {
  return isFlight
    ? {
        flight_from: v.flight_from.trim(),
        flight_to: v.flight_to.trim(),
        round_trip: v.round_trip === "" ? null : Number(v.round_trip),
      }
    : { flight_from: "", flight_to: "", round_trip: null };
}

/** "SFO → IAD · round trip", or "" when no route is recorded. */
export function routeLabel(e: { flight_from: string; flight_to: string; round_trip: number | null }) {
  if (!e.flight_from && !e.flight_to) return "";
  const trip = e.round_trip == null ? "" : e.round_trip ? " · round trip" : " · one way";
  return `${e.flight_from || "?"} → ${e.flight_to || "?"}${trip}`;
}
