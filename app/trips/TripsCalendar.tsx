"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, btnCls, ghostCls, inputCls } from "../api";

type CalTrip = { id: number; name: string; start_date: string; end_date: string; done: boolean };

// Validated categorical slots for the dark surface; a trip keeps its colour by id.
const COLORS = ["#3987e5", "#199e70", "#c98500", "#9085e9", "#d55181", "#d95926"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

const toMs = (iso: string) => new Date(iso + "T00:00:00Z").getTime();
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function niceRange(a: string, b: string) {
  const f = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
}

/** The day cell under a screen point, if any (cells carry data-date). */
function dateAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-date]");
  return el ? el.getAttribute("data-date") : null;
}

/**
 * A month grid with every trip drawn as a bar across its days; bars link to
 * the trip. Drag across days (or tap a first and last day on touch screens)
 * to start a new trip for that span.
 */
export default function TripsCalendar({ trips, today }: { trips: CalTrip[]; today: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(today.slice(0, 7));
  // In-progress selection; `dragging` only for mouse drags, touch uses two taps.
  const [sel, setSel] = useState<{ a: string; b: string; dragging: boolean } | null>(null);
  const [draft, setDraft] = useState<{ name: string; start: string; end: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lo = sel ? (sel.a < sel.b ? sel.a : sel.b) : "";
  const hi = sel ? (sel.a < sel.b ? sel.b : sel.a) : "";

  function finish(a: string, b: string) {
    setSel(null);
    setDraft({ name: "", start: a < b ? a : b, end: a < b ? b : a });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: number }>("trips", "POST", { name: draft.name, start_date: draft.start, end_date: draft.end });
      router.push(`/trips/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the trip");
      setBusy(false);
    }
  }
  const [y, m] = month.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const gridStart = first - new Date(first).getUTCDay() * DAY_MS; // back to Sunday
  const nextMonth = Date.UTC(y, m, 1);
  const weeks = Math.ceil((nextMonth - gridStart) / DAY_MS / 7);

  const inMonth = trips.filter((t) => t.start_date < toIso(nextMonth) && t.end_date >= toIso(first));

  return (
    <section className="rounded-lg border border-line bg-surface p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded px-2 py-0.5 text-xl text-faint hover:text-prose" aria-label="Previous month">
          ‹
        </button>
        <h2 className="min-w-[9.5rem] text-center text-base font-medium text-prose">
          {new Date(first).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
        </h2>
        <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded px-2 py-0.5 text-xl text-faint hover:text-prose" aria-label="Next month">
          ›
        </button>
        {month !== today.slice(0, 7) && (
          <button onClick={() => setMonth(today.slice(0, 7))} className="ml-1 rounded border border-line px-2 py-0.5 text-xs text-subtle hover:text-prose">
            Today
          </button>
        )}
        <span className="ml-auto text-xs text-faint">
          {inMonth.length ? `${inMonth.length} ${inMonth.length === 1 ? "trip" : "trips"}` : "No trips"}
        </span>
      </div>
      <p className="-mt-1 mb-2 text-xs text-faint">
        {sel && !sel.dragging ? (
          <>
            First day: {niceRange(sel.a, sel.a)} — now tap the last day ·{" "}
            <button className="underline" onClick={() => setSel(null)}>
              cancel
            </button>
          </>
        ) : (
          <>
            <span className="hidden sm:inline">Drag across days</span>
            <span className="sm:hidden">Tap a first and last day</span> to plan a new trip · tap a trip to open it
          </>
        )}
      </p>

      <div className="grid grid-cols-7 text-center text-[11px] text-faint">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1">
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>

      <div
        className="flex select-none flex-col border-t border-line"
        onPointerMove={(ev) => {
          if (!sel?.dragging) return;
          const d = dateAt(ev.clientX, ev.clientY);
          if (d && d !== sel.b) setSel({ ...sel, b: d });
        }}
        onPointerUp={() => {
          if (sel?.dragging) finish(sel.a, sel.b);
        }}
        onPointerLeave={() => {
          if (sel?.dragging) finish(sel.a, sel.b);
        }}
      >
        {Array.from({ length: weeks }, (_, w) => {
          const weekStart = gridStart + w * 7 * DAY_MS;
          const weekEnd = weekStart + 6 * DAY_MS;
          // This week's slice of each trip, stacked into lanes so overlaps don't collide.
          const segs = trips
            .filter((t) => toMs(t.start_date) <= weekEnd && toMs(t.end_date) >= weekStart)
            .map((t) => {
              const s = Math.max(toMs(t.start_date), weekStart);
              const e = Math.min(toMs(t.end_date), weekEnd);
              return {
                t,
                col: Math.round((s - weekStart) / DAY_MS),
                span: Math.round((e - s) / DAY_MS) + 1,
                startsHere: toMs(t.start_date) >= weekStart,
                endsHere: toMs(t.end_date) <= weekEnd,
              };
            })
            .sort((a, b) => a.col - b.col || b.span - a.span);
          const laneEnds: number[] = [];
          const placed = segs.map((sg) => {
            let lane = laneEnds.findIndex((end) => end < sg.col);
            if (lane === -1) {
              lane = laneEnds.length;
              laneEnds.push(-1);
            }
            laneEnds[lane] = sg.col + sg.span - 1;
            return { ...sg, lane };
          });
          return (
            <div key={w} className="relative grid grid-cols-7 border-b border-line" style={{ minHeight: 44 + laneEnds.length * 22 }}>
              {Array.from({ length: 7 }, (_, d) => {
                const iso = toIso(weekStart + d * DAY_MS);
                const otherMonth = iso.slice(0, 7) !== month;
                const isToday = iso === today;
                return (
                  <div
                    key={d}
                    data-date={iso}
                    onPointerDown={(ev) => {
                      if (ev.button !== 0) return;
                      if (ev.pointerType === "mouse") {
                        ev.preventDefault();
                        setSel({ a: iso, b: iso, dragging: true });
                      } else if (sel && !sel.dragging) {
                        finish(sel.a, iso);
                      } else {
                        setSel({ a: iso, b: iso, dragging: false });
                      }
                    }}
                    className={`cursor-pointer border-line px-1 pt-1 text-[11px] transition-colors sm:px-1.5 ${d ? "border-l" : ""} ${
                      sel && iso >= lo && iso <= hi ? "bg-accent/30" : otherMonth ? "bg-canvas/40" : "hover:bg-lift/40"
                    }`}
                  >
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 tabular-nums ${
                        isToday ? "bg-accent text-prose" : otherMonth ? "text-faint/60" : "text-faint"
                      }`}
                    >
                      {Number(iso.slice(8))}
                    </span>
                  </div>
                );
              })}
              <div
                className={`pointer-events-none absolute inset-x-0 top-7 grid grid-cols-7 gap-y-0.5 px-0.5 ${sel?.dragging ? "[&>a]:pointer-events-none" : ""}`}
                style={{ gridAutoRows: 20 }}
              >
                {placed.map(({ t, col, span, lane, startsHere, endsHere }) => (
                  <Link
                    key={t.id}
                    href={`/trips/${t.id}`}
                    title={`${t.name} · ${t.start_date} → ${t.end_date}`}
                    className="pointer-events-auto mx-px flex items-center overflow-hidden whitespace-nowrap px-1.5 text-[10px] leading-none text-white transition-[filter] hover:brightness-110 sm:text-xs"
                    style={{
                      gridColumn: `${col + 1} / span ${span}`,
                      gridRow: lane + 1,
                      background: COLORS[t.id % COLORS.length],
                      opacity: t.done ? 0.45 : 1,
                      borderRadius: `${startsHere ? 4 : 0}px ${endsHere ? 4 : 0}px ${endsHere ? 4 : 0}px ${startsHere ? 4 : 0}px`,
                    }}
                  >
                    <span className="truncate">
                      {startsHere || col === 0 ? t.name : ""}
                      {t.done && startsHere ? " ✓" : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setDraft(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={create}
            className="flex w-full flex-col gap-3 rounded-t-2xl border border-line bg-surface p-5 pb-8 sm:max-w-sm sm:rounded-lg sm:pb-5"
          >
            <h3 className="text-sm font-medium text-prose">New trip</h3>
            <p className="text-sm text-subtle">{niceRange(draft.start, draft.end)}</p>
            <input autoFocus required placeholder="Trip name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
              <input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value, end: draft.end < e.target.value ? e.target.value : draft.end })} className={inputCls} />
              to
              <input type="date" min={draft.start} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={inputCls} />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex items-center gap-2">
              <button disabled={busy} className={btnCls}>
                {busy ? "Creating…" : "Create trip"}
              </button>
              <button type="button" className={ghostCls} onClick={() => setDraft(null)}>
                cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
