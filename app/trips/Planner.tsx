"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, usd } from "../api";
import type { Planning, Trip } from "@/lib/queries";
import { AMBER, daysUntil, deadline, RED, shortDate, timeLabel, tzLabel, zonedInstant } from "./plan";


/** The current time, ticking every second; null until mounted (so server and client render alike). */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, []);
  return now;
}

/** A big live countdown to the next trip's first flight or event (or its first day), plus any trip happening now. */
export function Countdown({ trips, starts: tripStarts, today }: { trips: Trip[]; starts: Planning["starts"]; today: string }) {
  const now = useNow();
  const live = trips.filter((t) => !t.done && t.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  // A trip with no events on day one starts at midnight, in its own zone.
  const starts = live.map((t) => {
    const s = tripStarts[t.id];
    return { t, s, at: s ? zonedInstant(s.date, s.hour, s.tz) : zonedInstant(t.start_date, 0, t.time_zone) };
  });
  const next = now == null ? starts.find((s) => s.t.start_date > today) : starts.find((s) => s.at > now);
  const current = live.find((t) => t.start_date <= today && t.end_date >= today && t.id !== next?.t.id);

  if (!next && !current) return null;
  const left = next && now != null ? Math.max(0, next.at - now) : null;
  const parts =
    left == null
      ? null
      : [
          { n: Math.floor(left / 86_400_000), label: "days" },
          { n: Math.floor(left / 3_600_000) % 24, label: "hours" },
          { n: Math.floor(left / 60_000) % 60, label: "min" },
          { n: Math.floor(left / 1000) % 60, label: "sec" },
        ];

  return (
    <section className="relative overflow-hidden rounded-xl border border-accent/60 bg-gradient-to-br from-accent-dim via-surface to-surface p-5 shadow-lg sm:p-6">
      {current && (
        <Link href={`/trips/${current.id}`} className="mb-3 inline-block rounded-full bg-[#17a06b26] px-3 py-1 text-xs text-[#17a06b] hover:underline">
          ● Happening now: {current.name} · day {daysUntil(today, current.start_date) + 1} of {daysUntil(current.end_date, current.start_date) + 1}
        </Link>
      )}
      {next && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-faint">Next trip</p>
            <Link href={`/trips/${next.t.id}`} className="block truncate text-2xl font-medium text-prose hover:underline sm:text-3xl">
              {next.t.name}
            </Link>
            <p className="mt-1 text-sm text-subtle">
              {shortDate(next.s?.date ?? next.t.start_date, true)}
              {next.s && `, ${timeLabel(next.s.hour)}`}
              {(next.s ? next.s.tz : next.t.time_zone) && ` ${tzLabel(next.s ? next.s.tz : next.t.time_zone)}`}
              {next.s?.airport && ` · ✈ ${next.s.airport}`}
            </p>
          </div>
          <div className="flex gap-2 sm:gap-3" aria-live="off">
            {(parts ?? [{ n: null, label: "days" }, { n: null, label: "hours" }, { n: null, label: "min" }, { n: null, label: "sec" }]).map((p) => (
              <div key={p.label} className="flex w-16 flex-col items-center rounded-lg border border-line bg-canvas/70 py-2 sm:w-20">
                <span className="text-2xl font-medium tabular-nums text-prose sm:text-4xl">{p.n == null ? "–" : String(p.n).padStart(2, "0")}</span>
                <span className="text-[10px] uppercase tracking-widest text-faint">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Everything still unbooked on upcoming trips, grouped by trip, plus the budget page's open to-dos. */
export function ToBook({ groups, todos }: { groups: Planning["toBook"]; todos: Planning["todos"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const total = groups.reduce((s, g) => s + g.items.length, 0) + todos.length;
  const estimated = todos.reduce((s, t) => s + (t.cost ?? 0), 0);
  async function finish(id: number) {
    setBusy(true);
    try {
      await api(`todos/${id}`, "PUT", { done: true });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-subtle">Still to book</h2>
        {total > 0 && <span className="rounded-full bg-[#e0a63a26] px-2 py-0.5 text-xs text-[#e0a63a]">{total}</span>}
      </div>
      {total === 0 ? (
        <p className="text-sm text-faint">
          All booked. Events marked “Not booked”, unconfirmed stays and rental cars, and to-dos from the Budget page show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {todos.length > 0 && (
            <div>
              <Link href="/" className="flex items-baseline justify-between text-xs uppercase tracking-wide text-faint hover:text-prose">
                <span>To do →</span>
                {estimated > 0 && <span className="normal-case tracking-normal tabular-nums">est. {usd(estimated, 0)}</span>}
              </Link>
              <ul className="mt-1 flex flex-col gap-1">
                {todos.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={busy}
                      onChange={() => finish(t.id)}
                      className="translate-y-0.5"
                      aria-label={`Mark “${t.text}” done`}
                    />
                    <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                      <span className="block truncate text-prose sm:min-w-0">{t.text}</span>
                      <span className="block text-xs text-faint sm:ml-auto sm:shrink-0">
                        {t.trip_name && `${t.trip_name} · `}
                        {t.cost == null ? "no estimate" : `~${usd(t.cost)}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.trip_id}>
              <Link href={`/trips/${g.trip_id}`} className="text-xs uppercase tracking-wide text-faint hover:text-prose">
                {g.trip_name} →
              </Link>
              <ul className="mt-1 flex flex-col gap-1">
                {g.items.map((i, k) => (
                  <li key={k} className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden>{i.kind === "stay" ? "🏨" : i.kind === "car" ? "🚗" : "🎟"}</span>
                    <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                      <span className="block truncate text-prose sm:min-w-0">{i.label}</span>
                      <span className="block text-xs text-faint sm:ml-auto sm:shrink-0">
                        {i.kind !== "event" ? "not confirmed · " : ""}
                        {i.end_date !== i.date ? `${shortDate(i.date)} – ${shortDate(i.end_date)}` : shortDate(i.date, true)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Upcoming free-cancellation deadlines as a timeline, red within 3 days, amber within a week. */
export function Deadlines({ items, today }: { items: Planning["deadlines"]; today: string }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-subtle">Deadlines coming up</h2>
      {items.length === 0 ? (
        <p className="text-sm text-faint">No cancellation deadlines ahead. Add a “free cancellation until” date to a stay or rental car (in a trip&apos;s Edit mode).</p>
      ) : (
        <ol className="relative ml-1.5 flex flex-col gap-4 border-l border-line pl-5">
          {items.map((d, k) => {
            const u = deadline(d.cancel_by, today);
            const urgent = u.color === RED;
            return (
              <li key={k} className="relative">
                <span
                  className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface"
                  style={{ background: u.color === "var(--subtle)" ? "var(--line)" : u.color, boxShadow: urgent ? `0 0 0 3px ${RED}40` : undefined }}
                />
                <p className="text-sm">
                  <span className="text-prose">{shortDate(d.cancel_by, true)}</span>
                  <span style={{ color: u.color === "var(--subtle)" ? undefined : u.color }} className={u.color === "var(--subtle)" ? "text-faint" : ""}>
                    {" "}
                    · {urgent && "⚠ "}
                    {u.text}
                  </span>
                </p>
                <p className="text-sm text-subtle">
                  Last day to cancel free: {d.kind === "car" ? "🚗 " : ""}
                  {d.accommodation}
                </p>
                <Link href={`/trips/${d.trip_id}`} className="text-xs text-faint hover:text-prose">
                  {d.trip_name} · {d.from === d.to ? shortDate(d.from) : `${shortDate(d.from)} – ${shortDate(d.to)}`}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-faint">
        <span style={{ color: RED }}>●</span> 3 days or less · <span style={{ color: AMBER }}>●</span> within a week
      </p>
    </section>
  );
}
