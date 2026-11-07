"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { BudgetSummary, Expense, Todo } from "@/lib/queries";
import { isFlight } from "@/lib/flight";
import { api, btnCls, ghostCls, inputCls, usd } from "./api";
import FlightFields, { emptyFlight, flightPayload, routeLabel, type FlightValue } from "./FlightFields";
import Todos from "./Todos";
import { loggedDay } from "./trips/plan";

type TripRef = { id: number; name: string; start_date: string };

const OK = "#17a06b";
const BAD = "#e66767";
const TRAVEL = "#3987e5";
const VISITING = "#e87ba4";
const TRACK = "#243028";

function monthName(m: string, long = false) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    ...(long ? { year: "numeric" } : {}),
  });
}

/** Travel vs visiting as a small donut, with the split beside it. */
function KindDonut({ travel, visiting }: { travel: number; visiting: number }) {
  const total = travel + visiting;
  const r = 52;
  const C = 2 * Math.PI * r;
  const tShare = total > 0 ? travel / total : 0;
  const gap = total > 0 && travel > 0 && visiting > 0 ? 3 : 0;
  return (
    // The ring fills whatever height its card gets (the card stretches to match Cost per trip).
    <div className="flex h-full flex-col gap-4">
      <div className="relative min-h-36 flex-1">
      <svg viewBox="0 0 140 140" className="absolute inset-0 h-full w-full" role="img" aria-label={`Travel ${usd(travel, 0)}, visiting ${usd(visiting, 0)}`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke={TRACK} strokeWidth="18" />
        {total > 0 && (
          <>
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={TRAVEL}
              strokeWidth="18"
              strokeDasharray={`${Math.max(0, tShare * C - gap)} ${C}`}
              transform="rotate(-90 70 70)"
            />
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={VISITING}
              strokeWidth="18"
              strokeDasharray={`${Math.max(0, (1 - tShare) * C - gap)} ${C}`}
              transform={`rotate(${-90 + tShare * 360} 70 70)`}
            />
          </>
        )}
        <text x="70" y="66" textAnchor="middle" fontSize="11" fill="#8aa498">
          Spent
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="15" fill="#deeade">
          {usd(total, 0)}
        </text>
      </svg>
      </div>
      <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm">
        {[
          { label: "Travel", note: "trips together", value: travel, color: TRAVEL },
          { label: "Visiting", note: "seeing each other", value: visiting, color: VISITING },
        ].map((k) => (
          <li key={k.label} className="flex flex-col">
            <span className="flex items-center gap-2 text-subtle">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: k.color }} />
              {k.label}
              <span className="text-xs text-faint">{total > 0 ? `${((k.value / total) * 100).toFixed(0)}%` : ""}</span>
            </span>
            <span className="pl-[18px] tabular-nums text-prose">{usd(k.value)}</span>
            <span className="pl-[18px] text-xs text-faint">{k.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Expense-type colours, assigned in order of total spend; types past the palette share OTHER.
const CATEGORY_COLORS = ["#3987e5", "#e87ba4", "#17a06b", "#e0a63a", "#9a7be8", "#3fb8c4", "#e5794a"];
const OTHER = "#6b7a72";

function categoryColors(rows: BudgetSummary["byCategory"]): Map<string, string> {
  return new Map(rows.map((r, i) => [r.category, CATEGORY_COLORS[i] ?? OTHER]));
}

/** "2026-10-01".."2026-10-03" → "10/1–3"; across months "10/30–11/2"; one day "10/1". */
function shortRange(start: string, end: string): string {
  if (!start) return "";
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = (end || start).split("-").map(Number);
  if (end === start || !end) return `${sm}/${sd}`;
  return sm === em ? `${sm}/${sd}–${ed}` : `${sm}/${sd}–${em}/${ed}`;
}

// Trips shown before "Show all": three rows of three, or five on a phone's single column.
// The "Not linked" entry is always shown.
const TRIPS_SHOWN = 9;
const TRIPS_SHOWN_PHONE = 5;

/** A trip's shade in the master bar: greens from light (biggest) to dark; unlinked spending grey. */
function shareShade(rank: number, count: number, linked: boolean) {
  if (!linked) return "#5a6b62";
  const t = count > 1 ? rank / (count - 1) : 0;
  return `hsl(152 ${Math.round(55 - 15 * t)}% ${Math.round(64 - 30 * t)}%)`;
}

/**
 * A "master bar" of everything spent, one segment per trip (its share of the
 * total), then a grid of trips, most expensive first. Each trip's own bar is
 * its total split by expense type.
 */
function TripBars({ rows, colors }: { rows: BudgetSummary["byTrip"]; colors: Map<string, string> }) {
  const [showAll, setShowAll] = useState(false);
  // The trip under the pointer, in either the master bar or the grid: highlighted in both.
  const [hover, setHover] = useState<number | "none" | null>(null);
  // A small readout that follows the pointer over any bar segment (tap on phones).
  const [tip, setTip] = useState<{ x: number; y: number; title: string; detail: string } | null>(null);
  const tipProps = (title: string, detail: string) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, title, detail }),
    onMouseLeave: () => setTip(null),
    onClick: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, title, detail }),
  });
  const grand = rows.reduce((t, r) => t + r.total, 0);
  if (rows.length === 0) return <p className="text-sm text-faint">No spending logged yet.</p>;
  const keyOf = (r: (typeof rows)[number]) => r.trip_id ?? "none";
  const shareOf = (r: (typeof rows)[number]) => (grand > 0 ? r.total / grand : 0);
  const pct = (x: number) => `${x >= 0.095 ? Math.round(x * 100) : (x * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const linkedCount = rows.filter((r) => r.trip_id != null).length;
  const shade = (r: (typeof rows)[number]) => shareShade(rows.indexOf(r), linkedCount, r.trip_id != null);
  const order = [...colors.keys()];
  const linked = rows.filter((r) => r.trip_id != null);
  const visible = showAll ? rows : [...linked.slice(0, TRIPS_SHOWN), ...rows.filter((r) => r.trip_id == null)];
  // One toggle per layout, since each hides a different number of trips.
  const toggles = [
    { limit: TRIPS_SHOWN_PHONE, cls: "sm:hidden" },
    { limit: TRIPS_SHOWN, cls: "hidden sm:block" },
  ].filter((t) => linked.length > t.limit);
  return (
    <>
      <div className="mb-4">
        {/* Numbers only on hover: the bar and legend stay uncluttered. */}
        <div className="mb-1 text-xs text-faint">Share of everything spent</div>
        <div className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded" style={{ background: TRACK }}>
          {rows.map((r) => {
            const label = r.trip_id == null ? "Not linked to a trip" : r.name;
            return (
              <div
                key={keyOf(r)}
                {...tipProps(label, `${usd(r.total)} · ${pct(shareOf(r))} of ${usd(grand, 0)}`)}
                onMouseEnter={() => setHover(keyOf(r))}
                onMouseLeave={() => {
                  setHover(null);
                  setTip(null);
                }}
                className="cursor-default transition-opacity"
                style={{
                  width: `${shareOf(r) * 100}%`,
                  background: shade(r),
                  opacity: hover == null || hover === keyOf(r) ? 1 : 0.35,
                }}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-faint">
          {rows
            .filter((r) => r.trip_id != null)
            .slice(0, 4)
            .map((r) => (
              <span key={keyOf(r)} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ background: shade(r) }} />
                <span className="max-w-32 truncate">{r.name}</span>
              </span>
            ))}
          {linkedCount > 4 && <span>+{linkedCount - 4} more — hover the bar</span>}
        </div>
      </div>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-3">
        {visible.map((r, i) => {
          const label = r.trip_id == null ? "Not linked to a trip" : r.name;
          const parts = order.filter((c) => r.categories[c] > 0);
          const inner = (
            <>
              <div className="flex items-baseline gap-2 text-sm">
                <span className={`truncate ${r.trip_id == null ? "italic text-faint" : "text-subtle"}`} title={label}>
                  {label}
                </span>
                {r.start_date && (
                  <span className="shrink-0 text-xs tabular-nums text-faint">{shortRange(r.start_date, r.end_date)}</span>
                )}
                <span className="ml-auto shrink-0 tabular-nums text-prose">{usd(r.total, 0)}</span>
              </div>
              <div className="mt-1 flex h-2 w-full gap-px overflow-hidden rounded-sm" style={{ background: TRACK }}>
                {parts.map((c) => (
                  <div
                    key={c}
                    {...tipProps(c, `${usd(r.categories[c])} · ${Math.round((r.categories[c] / r.total) * 100)}% of ${label}`)}
                    style={{ width: `${(r.categories[c] / r.total) * 100}%`, background: colors.get(c) }}
                  />
                ))}
              </div>
            </>
          );
          return (
            <li
              key={r.trip_id ?? "none"}
              onMouseEnter={() => setHover(keyOf(r))}
              onMouseLeave={() => setHover(null)}
              className={`min-w-0 rounded transition-colors ${hover === keyOf(r) ? "bg-lift/40" : ""} ${
                !showAll && r.trip_id != null && i >= TRIPS_SHOWN_PHONE ? "hidden sm:block" : ""
              }`}
            >
              {r.trip_id == null ? (
                inner
              ) : (
                <Link href={`/trips/${r.trip_id}`} className="-mx-1 block rounded px-1 py-0.5 transition-colors hover:bg-lift/50">
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {toggles.map((t) => (
        <button
          key={t.limit}
          type="button"
          onClick={() => setShowAll(!showAll)}
          className={`mt-2 text-xs text-faint hover:text-subtle ${t.cls}`}
        >
          {showAll ? "Show fewer" : `Show all ${linked.length} trips (${linked.length - t.limit} more)`}
        </button>
      ))}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          // Opens to the left of the pointer on the right half of the screen, so it never runs off the edge.
          style={
            tip.x > window.innerWidth / 2
              ? { right: window.innerWidth - tip.x + 12, top: tip.y + 14 }
              : { left: tip.x + 12, top: tip.y + 14 }
          }
        >
          <span className="block font-medium text-prose">{tip.title}</span>
          <span className="tabular-nums text-subtle">{tip.detail}</span>
        </div>
      )}
    </>
  );
}

function CategoryBars({ rows, total, colors }: { rows: BudgetSummary["byCategory"]; total: number; colors: Map<string, string> }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
      {rows.map((r) => (
        <div key={r.category}>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-subtle">{r.category}</span>
            <span className="text-xs text-faint">
              {r.count} {r.count === 1 ? "expense" : "expenses"}
            </span>
            <span className="ml-auto tabular-nums text-prose">{usd(r.total)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-faint">
              {total > 0 ? `${((r.total / total) * 100).toFixed(0)}%` : ""}
            </span>
          </div>
          <div className="mt-1 h-2 w-full rounded-sm" style={{ background: TRACK }}>
            <div className="h-full rounded-sm" style={{ width: `${(r.total / max) * 100}%`, background: colors.get(r.category) }} />
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-faint">No spending logged yet.</p>}
    </div>
  );
}

export default function BudgetClient({
  user,
  summary,
  expenses,
  trips,
  categories,
  todos,
}: {
  user: string;
  summary: BudgetSummary;
  expenses: Expense[];
  trips: TripRef[];
  categories: string[];
  todos: Todo[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const people = summary.people.map((p) => p.person);
  const catColors = categoryColors(summary.byCategory);
  const me = people.find((p) => p.slug === user) ?? people[0];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const defaultMonth = summary.months.includes(thisMonth) ? thisMonth : summary.months[0];
  // Suggestions for the free-typed category: the defaults plus anything already used.
  const categoryOptions = [...new Set([...categories, ...expenses.map((e) => e.category).filter(Boolean)])];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // ---- expense form + filters ----
  const blank = {
    person_id: me?.id ?? 0,
    month: defaultMonth,
    category: "",
    kind: "visiting" as "travel" | "visiting",
    amount: "",
    notes: "",
    trip_id: "",
  };
  const [form, setForm] = useState(blank);
  const [flight, setFlight] = useState<FlightValue>(emptyFlight);
  const [draftFlight, setDraftFlight] = useState<FlightValue>(emptyFlight);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string | number>>({});
  const [fPerson, setFPerson] = useState("");
  const [fKind, setFKind] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [fTrip, setFTrip] = useState("");

  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? "—";
  const tripName = (id: number | null) => trips.find((t) => t.id === id)?.name;
  // An expense's date for sorting: its trip's first day when it has one, else the start of its month.
  const tripStart = useMemo(() => new Map(trips.map((t) => [t.id, t.start_date])), [trips]);
  const shown = useMemo(() => {
    const dateOf = (e: Expense) => (e.trip_id != null && tripStart.get(e.trip_id)) || `${e.month}-01`;
    return expenses
        .filter(
          (e) =>
            (!fPerson || String(e.person_id) === fPerson) &&
            (!fKind || e.kind === fKind) &&
            (!fMonth || e.month === fMonth) &&
            (!fTrip || (fTrip === "none" ? e.trip_id == null : String(e.trip_id) === fTrip))
        )
        .sort((a, b) => {
          const byDate = dateOf(a).localeCompare(dateOf(b)) || a.month.localeCompare(b.month) || a.id - b.id;
          return newestFirst ? -byDate : byDate;
        });
  }, [expenses, fPerson, fKind, fMonth, fTrip, newestFirst, tripStart]);
  const shownTotal = shown.reduce((s, e) => s + e.amount, 0);

  function addExpense(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      await api("expenses", "POST", {
        ...form,
        ...flightPayload(isFlight(form.category), flight),
        category: form.category.trim() || "Other",
        trip_id: form.trip_id || null,
      });
      setForm({ ...blank, person_id: form.person_id, month: form.month, kind: form.kind, trip_id: form.trip_id });
      setFlight(emptyFlight);
    });
  }

  function startEdit(x: Expense) {
    setEditing(x.id);
    setDraft({
      person_id: x.person_id,
      month: x.month,
      category: x.category,
      kind: x.kind,
      amount: x.amount,
      notes: x.notes,
      trip_id: x.trip_id ?? "",
    });
    setDraftFlight({
      flight_from: x.flight_from,
      flight_to: x.flight_to,
      round_trip: x.round_trip == null ? "" : String(x.round_trip),
    });
  }

  const ifAllUnlocked = summary.fullYearPool - summary.spent;
  const poolPct = summary.unlockedPool > 0 ? Math.min(1, summary.spent / summary.unlockedPool) : 0;
  const monthly = people.reduce((s, p) => s + p.contribution, 0);

  return (
    <div className="flex flex-col gap-6">
      <datalist id="expense-categories">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-medium text-prose">
          Budget · {monthName(summary.cycle.start_month, true)} – {monthName(summary.cycle.end_month, true)}
        </h1>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {/* Pool: what's unlocked, what's spent, what's usable now vs eventually */}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.3fr_1fr]">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs text-faint">Unlocked pool</p>
          <p className="mt-1 text-2xl tabular-nums text-prose">{usd(summary.unlockedPool, 0)}</p>
          <label className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-faint">
            unlocked through
            <select
              value={summary.unlockedThrough}
              disabled={busy}
              onChange={(e) => run(() => api("unlocks", "PUT", { through: e.target.value }))}
              className={`${inputCls} py-0.5 text-xs`}
            >
              <option value="">nothing yet</option>
              {summary.months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m, true)}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-xs text-faint">{usd(monthly, 0)} added per month unlocked</p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs text-faint">Spent</p>
          <p className="mt-1 text-2xl tabular-nums text-prose">{usd(summary.spent)}</p>
          <div className="mt-2 h-1.5 w-full rounded-sm bg-line">
            <div className="h-full rounded-sm" style={{ width: `${poolPct * 100}%`, background: summary.remaining >= 0 ? TRAVEL : BAD }} />
          </div>
          <p className="mt-1 text-xs text-faint">{(poolPct * 100).toFixed(0)}% of the unlocked pool</p>
        </div>

        <div
          className="rounded-lg border-2 p-4"
          style={{ borderColor: summary.remaining >= 0 ? `${OK}88` : `${BAD}88`, background: summary.remaining >= 0 ? `${OK}14` : `${BAD}14` }}
        >
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: summary.remaining >= 0 ? OK : BAD }}>
            Available now
          </p>
          <p className="mt-1 text-3xl tabular-nums" style={{ color: summary.remaining >= 0 ? OK : BAD }}>
            {usd(summary.remaining)}
          </p>
          <p className="mt-1 text-xs text-subtle">
            {summary.remaining >= 0 ? "Unlocked and not yet spent — yours to use" : "Spent more than is unlocked"}
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-line p-4">
          <p className="text-xs text-faint">If every month unlocks</p>
          <p className="mt-1 text-xl tabular-nums text-subtle">{usd(ifAllUnlocked)}</p>
          <p className="mt-1 text-xs text-faint">
            left by {monthName(summary.cycle.end_month, true)} — not usable yet; {usd(ifAllUnlocked - summary.remaining, 0)} still locked
          </p>
        </div>
      </div>

      {/* Per person + correction check */}
      <div className="grid gap-3 md:grid-cols-2">
        {summary.people.map((p) => {
          const ok = p.remaining >= 0;
          return (
            <div key={p.person.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-prose">{p.person.name}</span>
                <label className="flex items-center gap-1.5 text-xs text-faint">
                  contributes
                  <input
                    type="number"
                    step="1"
                    min="0"
                    defaultValue={p.person.contribution}
                    key={p.person.contribution}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 0 && v !== p.person.contribution)
                        run(() => api(`people/${p.person.id}`, "PUT", { name: p.person.name, contribution: v }));
                    }}
                    className={`${inputCls} w-20 py-0.5 text-xs tabular-nums`}
                  />
                  / month
                </label>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-faint">Unlocked</dt>
                  <dd className="tabular-nums text-prose">{usd(p.unlocked, 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Spent</dt>
                  <dd className="tabular-nums text-prose">{usd(p.spent)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Available</dt>
                  <dd className="tabular-nums" style={{ color: ok ? OK : BAD }}>
                    {usd(p.remaining)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs" style={{ color: ok ? OK : BAD }}>
                {ok ? "✓ OK" : `Needs correction: ${usd(-p.remaining)} over what's unlocked`}
              </p>
            </div>
          );
        })}
      </div>

      {/* Where it went: kind (small) and per trip (large), then by category */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <section className="flex flex-col rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-4 text-sm font-medium text-subtle">Travel vs. visiting</h2>
          <div className="flex-1">
            <KindDonut travel={summary.travel} visiting={summary.visiting} />
          </div>
        </section>
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium text-subtle">Cost per trip</h2>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
              {summary.byCategory.map((c) => (
                <span key={c.category}>
                  <span style={{ color: catColors.get(c.category) }}>■</span> {c.category}
                </span>
              ))}
            </span>
          </div>
          <TripBars rows={summary.byTrip} colors={catColors} />
          {summary.byTrip.some((r) => r.trip_id == null) && (
            <p className="mt-3 text-xs text-faint">
              Link an expense to its trip (edit it below) to move it out of &ldquo;Not linked&rdquo;.
            </p>
          )}
        </section>
      </div>
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-4 text-sm font-medium text-subtle">By expense type</h2>
        <CategoryBars rows={summary.byCategory} total={summary.spent} colors={catColors} />
      </section>

      {/* Expenses (the two Expenditures tabs, merged) */}
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-subtle">Expenses</h2>
        <form onSubmit={addExpense} className="mb-4 flex flex-wrap items-end gap-2">
          <select value={form.person_id} onChange={(e) => setForm({ ...form, person_id: Number(e.target.value) })} className={inputCls} aria-label="Who paid">
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} className={inputCls} aria-label="Month">
            {summary.months.map((m) => (
              <option key={m} value={m}>
                {monthName(m, true)}
              </option>
            ))}
          </select>
          <input
            list="expense-categories"
            placeholder="Type (e.g. Flights)"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className={`${inputCls} w-40`}
            aria-label="Expense type"
          />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "travel" | "visiting" })} className={inputCls} aria-label="Travel or visiting">
            <option value="visiting">Visiting</option>
            <option value="travel">Travel</option>
          </select>
          <input required type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`${inputCls} w-28`} />
          <select value={form.trip_id} onChange={(e) => setForm({ ...form, trip_id: e.target.value })} className={inputCls} aria-label="Trip">
            <option value="">No trip</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} min-w-[180px] flex-1`} />
          {isFlight(form.category) && <FlightFields name="new-flight" value={flight} onChange={setFlight} required />}
          <button disabled={busy} className={btnCls}>
            Add
          </button>
        </form>

        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-faint">
          Filter
          <select value={fPerson} onChange={(e) => setFPerson(e.target.value)} className={`${inputCls} py-1 text-xs`}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} className={`${inputCls} py-1 text-xs`}>
            <option value="">Travel + visiting</option>
            <option value="travel">Travel</option>
            <option value="visiting">Visiting</option>
          </select>
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={`${inputCls} py-1 text-xs`}>
            <option value="">All months</option>
            {summary.months.map((m) => (
              <option key={m} value={m}>
                {monthName(m, true)}
              </option>
            ))}
          </select>
          <select value={fTrip} onChange={(e) => setFTrip(e.target.value)} className={`${inputCls} py-1 text-xs`}>
            <option value="">Any trip</option>
            <option value="none">Not on a trip</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className={`${ghostCls} rounded border border-line px-2 py-1`} onClick={() => setNewestFirst(!newestFirst)}>
            {newestFirst ? "Newest first ↓" : "Oldest first ↑"}
          </button>
          <span className="ml-auto tabular-nums">
            {shown.length} · <span className="text-prose">{usd(shownTotal)}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {shown.map((x) =>
                editing === x.id ? (
                  <tr key={x.id} className="border-t border-line bg-lift/40">
                    <td colSpan={6} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={draft.person_id} onChange={(e) => setDraft({ ...draft, person_id: Number(e.target.value) })} className={inputCls}>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <select value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} className={inputCls}>
                          {summary.months.map((m) => (
                            <option key={m} value={m}>
                              {monthName(m, true)}
                            </option>
                          ))}
                        </select>
                        <input list="expense-categories" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={`${inputCls} w-40`} />
                        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className={inputCls}>
                          <option value="visiting">Visiting</option>
                          <option value="travel">Travel</option>
                        </select>
                        <input type="number" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className={`${inputCls} w-28`} />
                        <select value={draft.trip_id} onChange={(e) => setDraft({ ...draft, trip_id: e.target.value })} className={inputCls}>
                          <option value="">No trip</option>
                          {trips.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={`${inputCls} min-w-[160px] flex-1`} />
                        {isFlight(String(draft.category)) && (
                          <FlightFields name={`edit-flight-${x.id}`} value={draftFlight} onChange={setDraftFlight} required={false} />
                        )}
                        <button
                          className={btnCls}
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api(`expenses/${x.id}`, "PUT", {
                                ...draft,
                                ...flightPayload(isFlight(String(draft.category)), draftFlight),
                                category: String(draft.category).trim() || "Other",
                                trip_id: draft.trip_id || null,
                              });
                              setEditing(null);
                            })
                          }
                        >
                          Save
                        </button>
                        <button className={ghostCls} onClick={() => setEditing(null)}>
                          cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={x.id} className="border-t border-line">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-subtle">
                      <span className="font-semibold text-prose" title="The month this expense counts toward">
                        {monthName(x.month)}
                      </span>
                      {x.trip_id != null && tripStart.get(x.trip_id) && (
                        <span className="ml-1 text-xs text-faint" title="The trip's first day">
                          · {new Date(tripStart.get(x.trip_id)! + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                      {loggedDay(x.created_at) && (
                        <span className="block text-[11px] text-faint" title="The day this expense was logged">
                          logged {loggedDay(x.created_at)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-prose">{personName(x.person_id)}</td>
                    <td className="py-1.5 pr-3 text-faint">
                      <span style={{ color: x.kind === "travel" ? TRAVEL : VISITING }}>■</span> {x.category} · {x.kind === "travel" ? "Travel" : "Visiting"}
                    </td>
                    <td className="py-1.5 pr-3 text-faint">
                      {routeLabel(x) && <span className="mr-1.5 text-subtle">✈ {routeLabel(x)}</span>}
                      {x.notes}
                      {x.trip_id != null && tripName(x.trip_id) && (
                        <span className="ml-1.5 rounded bg-lift px-1.5 py-0.5 text-xs text-subtle">{tripName(x.trip_id)}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-prose">{usd(x.amount)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <button className={`${ghostCls} mr-2`} onClick={() => startEdit(x)}>
                        edit
                      </button>
                      <button
                        className={`${ghostCls} hover:text-red-400`}
                        onClick={() => {
                          if (confirm(`Delete "${x.notes || x.category}" (${usd(x.amount)})?`)) run(() => api(`expenses/${x.id}`, "DELETE"));
                        }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                )
              )}
              {shown.length === 0 && (
                <tr>
                  <td className="py-4 text-sm text-faint">No expenses match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Todos todos={todos} trips={trips} leftForYear={ifAllUnlocked} />
    </div>
  );
}
