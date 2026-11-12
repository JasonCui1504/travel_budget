"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inputCls } from "../../api";

type Place = { value: string; detail: string; name?: string; kind?: string; address?: string; lat?: number; lng?: number };

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
  // The text the current results are for (to tell "no matches" from "not searched yet").
  const [searched, setSearched] = useState("");
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
        setSearched(q);
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
  const noMatch = open && !loading && !shown.length && searched === value.trim();
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
        title="Search a place name or a street address"
        aria-controls={listId}
        autoComplete="off"
      />
      {loading && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-faint">searching…</span>}
      {noMatch && (
        <p className="absolute inset-x-0 z-10 mt-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-faint shadow-lg">
          No matches. Try the street address (e.g. &ldquo;1 Rue de Rivoli, Paris&rdquo;), or keep the text as typed.
        </p>
      )}
      {shown.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 z-10 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
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
              className={`flex cursor-pointer items-start gap-2 rounded px-2.5 py-1.5 text-sm ${i === active ? "bg-lift" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-prose">📍 {p.name ?? p.value.split(", ")[0]}</span>
                  {p.kind && <span className="shrink-0 rounded bg-lift px-1.5 text-[10px] uppercase tracking-wide text-faint">{p.kind}</span>}
                </span>
                {/* The full address, so two look-alike results can be told apart. */}
                <span className="block text-xs leading-snug text-faint">{p.address ?? p.detail}</span>
              </span>
              {p.lat != null && p.lng != null && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  // Opens the map without picking the place or closing the list.
                  onMouseDown={(e) => e.stopPropagation()}
                  className="shrink-0 pt-0.5 text-[11px] text-faint underline-offset-2 hover:text-prose hover:underline"
                  title="See where this is on a map"
                >
                  map ↗
                </a>
              )}
            </li>
          ))}
          <li className="px-2.5 pb-0.5 pt-1 text-[10px] text-faint">Places and addresses from OpenStreetMap · type a street address for an exact spot</li>
        </ul>
      )}
    </div>
  );
}
