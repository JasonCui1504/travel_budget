"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Planning, Trip } from "@/lib/queries";
import { api, btnCls, inputCls, usd } from "../api";
import { Countdown, Deadlines, ToBook } from "./Planner";
import TripsCalendar from "./TripsCalendar";

// Leaflet needs the browser, so the map loads client-side only.
const AllTripsMap = dynamic(() => import("./TripMap").then((m) => m.AllTripsMap), {
  ssr: false,
  loading: () => <p className="text-sm text-faint">Loading map…</p>,
});

type Row = Trip & { spent: number };

function range(a: string, b: string) {
  const f = (d: string, y: boolean) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(y ? { year: "numeric" } : {}),
    });
  return a === b ? f(a, true) : `${f(a, false)} – ${f(b, true)}`;
}

function nights(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) + 1;
}

export default function TripsClient({ trips, today, planning }: { trips: Row[]; today: string; planning: Planning }) {

  const upcoming = trips.filter((t) => t.end_date >= today && !t.done).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = trips.filter((t) => t.end_date < today || t.done);

  const card = (t: Row) => (
    <Link
      key={t.id}
      href={`/trips/${t.id}`}
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-prose">{t.name}</span>
        {t.done && <span className="text-xs text-[#17a06b]">✓ done</span>}
      </span>
      <span className="text-xs text-faint">
        {range(t.start_date, t.end_date)} · {nights(t.start_date, t.end_date)} days
      </span>
      {t.spent > 0 && <span className="text-xs tabular-nums text-subtle">{usd(t.spent)} logged</span>}
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <Countdown trips={trips} starts={planning.starts} today={today} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ToBook groups={planning.toBook} todos={planning.todos} />
        <Deadlines items={planning.deadlines} today={today} />
      </div>

      {/*
        Trips are created by dragging across days in the calendar below. The
        "New trip" form is kept (NewTripForm, further down) in case it's wanted
        again — uncomment this line to bring it back:
        <NewTripForm />
      */}

      <TripsCalendar trips={trips} today={today} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-subtle">Upcoming</h2>
        {upcoming.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{upcoming.map(card)}</div>
        ) : (
          <p className="text-sm text-faint">Nothing planned yet.</p>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-subtle">Done and past</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{past.map(card)}</div>
        </section>
      )}

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-subtle">All trips on the map</h2>
        <AllTripsMap trips={trips} today={today} />
      </section>
    </div>
  );
}

/**
 * The old "New trip" form (name + first/last day). Not shown: trips are made
 * by dragging across the calendar. Render <NewTripForm /> in TripsClient to
 * bring it back.
 */
export function NewTripForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: number }>("trips", "POST", form);
      router.push(`/trips/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the trip");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-subtle">New trip</h2>
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-faint">
          Name
          <input
            required
            placeholder="e.g. Slice Dat Turkey"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={`${inputCls} w-64`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">
          First day
          <input
            required
            type="date"
            value={form.start_date}
            onChange={(e) =>
              setForm({
                ...form,
                start_date: e.target.value,
                end_date: form.end_date && form.end_date >= e.target.value ? form.end_date : e.target.value,
              })
            }
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">
          Last day
          <input
            required
            type="date"
            min={form.start_date || undefined}
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            className={inputCls}
          />
        </label>
        <button disabled={busy} className={btnCls}>
          Create trip
        </button>
        {error && <p className="w-full text-sm text-red-400">{error}</p>}
      </form>
      <p className="mt-2 text-xs text-faint">
        Creates a 12 AM – midnight calendar for every day — or drag across days in the calendar below.
      </p>
    </section>
  );
}
