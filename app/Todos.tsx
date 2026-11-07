"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Todo } from "@/lib/queries";
import { api, btnCls, ghostCls, inputCls, usd } from "./api";

type TripRef = { id: number; name: string; start_date: string };

/** The budget page's To do list: things to sort out, each with an optional cost estimate. */
export default function Todos({ todos, trips, leftForYear }: { todos: Todo[]; trips: TripRef[]; leftForYear: number }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const blank = { text: "", cost: "", trip_id: "" };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState(blank);
  const [showDone, setShowDone] = useState(false);

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

  const payload = (v: typeof blank) => ({ text: v.text, cost: v.cost === "" ? null : v.cost, trip_id: v.trip_id || null });
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const estimated = open.reduce((s, t) => s + (t.cost ?? 0), 0);
  const unpriced = open.filter((t) => t.cost == null).length;

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      await api("todos", "POST", payload(form));
      setForm({ ...blank, trip_id: form.trip_id });
    });
  }

  const tripSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">No trip</option>
      {trips.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );

  const row = (t: Todo) =>
    editing === t.id ? (
      <li key={t.id} className="flex flex-wrap items-center gap-2 border-t border-line bg-lift/40 py-2">
        <input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className={`${inputCls} min-w-[180px] flex-1`} />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Est. cost"
          value={draft.cost}
          onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
          className={`${inputCls} w-28`}
        />
        {tripSelect(draft.trip_id, (v) => setDraft({ ...draft, trip_id: v }))}
        <button
          className={btnCls}
          disabled={busy || !draft.text.trim()}
          onClick={() =>
            run(async () => {
              await api(`todos/${t.id}`, "PUT", payload(draft));
              setEditing(null);
            })
          }
        >
          Save
        </button>
        <button className={ghostCls} onClick={() => setEditing(null)}>
          cancel
        </button>
      </li>
    ) : (
      <li key={t.id} className="flex items-baseline gap-3 border-t border-line py-1.5 text-sm">
        <input
          type="checkbox"
          checked={t.done}
          disabled={busy}
          onChange={() => run(() => api(`todos/${t.id}`, "PUT", { done: !t.done }))}
          className="translate-y-0.5"
          aria-label={t.done ? "Mark not done" : "Mark done"}
        />
        <span className={`min-w-0 flex-1 ${t.done ? "text-faint line-through" : "text-prose"}`}>
          {t.text}
          {t.trip_name && <span className="ml-1.5 rounded bg-lift px-1.5 py-0.5 text-xs text-subtle no-underline">{t.trip_name}</span>}
        </span>
        <span className={`shrink-0 tabular-nums ${t.cost == null ? "text-xs text-faint" : t.done ? "text-faint" : "text-prose"}`}>
          {t.cost == null ? "no estimate" : `~${usd(t.cost)}`}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          <button
            className={`${ghostCls} mr-2`}
            onClick={() => {
              setEditing(t.id);
              setDraft({ text: t.text, cost: t.cost == null ? "" : String(t.cost), trip_id: t.trip_id == null ? "" : String(t.trip_id) });
            }}
          >
            edit
          </button>
          <button
            className={`${ghostCls} hover:text-red-400`}
            onClick={() => {
              if (confirm(`Delete "${t.text}"?`)) run(() => api(`todos/${t.id}`, "DELETE"));
            }}
          >
            delete
          </button>
        </span>
      </li>
    );

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-subtle">To do</h2>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <span className="ml-auto text-xs text-faint">
          {open.length} open · estimated <span className="tabular-nums text-prose">{usd(estimated)}</span>
          {unpriced > 0 && ` (${unpriced} without an estimate)`}
          {estimated > 0 && (
            <>
              {" "}
              · leaves{" "}
              <span className={`tabular-nums ${leftForYear - estimated >= 0 ? "text-prose" : "text-red-400"}`}>{usd(leftForYear - estimated)}</span>{" "}
              of the year&apos;s pool
            </>
          )}
        </span>
      </div>

      <form onSubmit={add} className="mb-3 flex flex-wrap items-center gap-2">
        <input
          required
          placeholder="Something to do or book…"
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          className={`${inputCls} min-w-[180px] flex-1`}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Est. cost"
          value={form.cost}
          onChange={(e) => setForm({ ...form, cost: e.target.value })}
          className={`${inputCls} w-28`}
        />
        {tripSelect(form.trip_id, (v) => setForm({ ...form, trip_id: v }))}
        <button className={btnCls} disabled={busy || !form.text.trim()}>
          Add
        </button>
      </form>

      {open.length === 0 ? (
        <p className="text-sm text-faint">Nothing to do. Open to-dos also show on the Trips page under “Still to book”.</p>
      ) : (
        <ul>{open.map(row)}</ul>
      )}

      {done.length > 0 && (
        <div className="mt-3">
          <button className={ghostCls} onClick={() => setShowDone(!showDone)}>
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          {showDone && <ul className="mt-1">{done.map(row)}</ul>}
        </div>
      )}
    </section>
  );
}
