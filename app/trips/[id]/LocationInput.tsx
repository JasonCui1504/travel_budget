"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inputCls } from "../../api";

type Place = { value: string; detail: string };

/**
 * The event's Location box with search-as-you-type place suggestions
 * (OpenStreetMap, via /api/places; places near the trip come first).
 * Free text still works: a suggestion only fills the box.
 */
export default function LocationInput({
  value,
  onChange,
  tripId,
  onPick,
  placeholder = "📍 Location — search a place or address (optional)",
  className = `${inputCls} w-full`,
  label = "Location",
}: {
  value: string;
  onChange: (v: string) => void;
  tripId: number;
  /** Called with a picked suggestion (after onChange). */
  onPick?: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  // The text a suggestion was picked for: don't search again for it.
  const picked = useRef(value);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || q === picked.current) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/places?trip=${tripId}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { places?: Place[] };
        setResults(data.places ?? []);
        setActive(-1);
        setOpen(true);
      } catch {
        // Aborted by the next keystroke, or offline: keep typing freely.
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, tripId]);

  function choose(p: Place) {
    picked.current = p.value;
    onChange(p.value);
    onPick?.(p.value);
    setOpen(false);
  }

  const shown = open && value.trim().length >= 3 ? results : [];
  return (
    <div className="relative">
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!shown.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = shown.length;
            setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            choose(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={className}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        autoComplete="off"
      />
      {loading && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-faint">searching…</span>}
      {shown.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          {shown.map((p, i) => (
            <li
              key={p.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer rounded px-2.5 py-1.5 text-sm ${i === active ? "bg-lift" : ""}`}
            >
              <span className="block truncate text-prose">📍 {p.value.split(", ")[0]}</span>
              <span className="block truncate text-xs text-faint">{p.detail}</span>
            </li>
          ))}
          <li className="px-2.5 pb-0.5 pt-1 text-[10px] text-faint">Places from OpenStreetMap</li>
        </ul>
      )}
    </div>
  );
}
