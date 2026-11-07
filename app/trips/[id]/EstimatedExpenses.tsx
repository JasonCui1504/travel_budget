"use client";

import { useState } from "react";
import type { EstimatedExpense } from "@/lib/queries";
import { api, btnCls, ghostCls, inputCls, usd } from "../../api";

/**
 * A trip's estimated costs, below its Expenses: what's still expected to be
 * spent. They don't count in the budget; the header adds them to what's
 * logged for a projected trip total.
 */
export default function EstimatedExpenses({
  estimates,
  tripId,
  spent,
  editing,
  busy,
  run,
  categories,
}: {
  estimates: EstimatedExpense[];
  tripId: number;
  spent: number;
  editing: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  categories: string[];
}) {
  const blank = { item: "", category: "", amount: "" };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState(blank);
  const total = estimates.reduce((s, e) => s + e.amount, 0);

  if (!editing && estimates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-2.5 text-sm text-faint">
        Estimated expenses · none yet <span className="text-xs">— add them in Edit</span>
      </p>
    );
  }

  const fields = (v: typeof blank, set: (v: typeof blank) => void) => (
    <>
      <input
        required
        placeholder="What (e.g. Ryokan, 2 nights)"
        value={v.item}
        onChange={(e) => set({ ...v, item: e.target.value })}
        className={`${inputCls} min-w-[160px] flex-1`}
      />
      <input
        list="trip-estimate-categories"
        placeholder="Type (e.g. Hotels)"
        value={v.category}
        onChange={(e) => set({ ...v, category: e.target.value })}
        className={`${inputCls} w-36`}
      />
      <input
        required
        type="number"
        step="0.01"
        min="0"
        placeholder="Est. amount"
        value={v.amount}
        onChange={(e) => set({ ...v, amount: e.target.value })}
        className={`${inputCls} w-28`}
      />
    </>
  );

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-subtle">Estimated expenses</h2>
        <span className="text-xs tabular-nums text-faint">
          {usd(total)} estimated · with {usd(spent)} logged, about <span className="text-prose">{usd(spent + total)}</span> in all
        </span>
      </div>
      <datalist id="trip-estimate-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <ul className="flex flex-col">
        {estimates.map((x) =>
          editId === x.id ? (
            <li key={x.id} className="border-t border-line py-1.5">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run(() => api(`estimated/${x.id}`, "PUT", { ...draft, trip_id: tripId }))) setEditId(null);
                }}
              >
                {fields(draft, setDraft)}
                <button disabled={busy} className={btnCls}>
                  Save
                </button>
                <button type="button" className={ghostCls} onClick={() => setEditId(null)}>
                  cancel
                </button>
              </form>
            </li>
          ) : (
            <li key={x.id} className="flex items-baseline gap-2 border-t border-line py-1.5 text-sm">
              <span className="min-w-0 truncate text-prose">{x.item}</span>
              {x.category && <span className="shrink-0 text-xs text-faint">{x.category}</span>}
              <span className="ml-auto shrink-0 tabular-nums text-prose">~{usd(x.amount)}</span>
              {editing && (
                <span className="shrink-0 whitespace-nowrap">
                  <button
                    className={`${ghostCls} mr-2`}
                    onClick={() => {
                      setEditId(x.id);
                      setDraft({ item: x.item, category: x.category, amount: String(x.amount) });
                    }}
                  >
                    edit
                  </button>
                  <button
                    className={`${ghostCls} hover:text-red-400`}
                    onClick={() => confirm(`Delete the estimate "${x.item}"?`) && run(() => api(`estimated/${x.id}`, "DELETE"))}
                  >
                    delete
                  </button>
                </span>
              )}
            </li>
          )
        )}
        {estimates.length === 0 && <li className="text-sm text-faint">None yet.</li>}
      </ul>
      {editing && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api("estimated", "POST", { ...form, trip_id: tripId }))) setForm(blank);
          }}
        >
          {fields(form, setForm)}
          <button disabled={busy} className={btnCls}>
            Add
          </button>
        </form>
      )}
      <p className="mt-2 text-[11px] text-faint">Estimates don&apos;t count toward the budget. Once you pay, log it under Expenses and delete the estimate.</p>
    </section>
  );
}
