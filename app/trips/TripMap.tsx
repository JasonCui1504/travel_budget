"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { km, type Leg, type MapData, type Stop } from "@/lib/geo";
import { shortDate, timeLabel } from "./plan";

// The trip maps: one trip's stops numbered in order with the roads between
// them (long hops drawn as dashed flights), or every trip at once. Places and
// routes come from the server a few at a time, so it re-asks while `pending`.

const PALETTE = ["#3987e5", "#e87ba4", "#17a06b", "#e0a63a", "#9a7be8", "#3fb8c4", "#e5794a"];
const FLIGHT = "#8aa498";

type TripRef = { id: number; name: string; start_date: string; end_date: string; done: boolean; show_route: boolean };

/** A distinct colour for the i-th day (or trip): the palette, then evenly spread hues past it. */
function colorAt(i: number) {
  return i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 137.5) % 360)} 65% 62%)`;
}


export function duration(min: number) {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
}

/** Whether a stop is part of this day (a night's stay is also the start of the next day). */
const onDay = (s: Stop, d: string) => s.date === d || (!!s.until && s.date <= d && d <= s.until);

/** "Mar 3, 9 AM", or for a night's stay "night of Mar 3". */
const when = (s: Stop) => (s.hotel ? `night of ${shortDate(s.date, true)}` : `${shortDate(s.date, true)}, ${timeLabel(s.start_hour)}`);

const miles = (km: number) => `${Math.round(km * 0.621371).toLocaleString("en-US")} mi`;

function numberIcon(n: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:${color};color:#0d1110;border:2px solid #deeade;display:flex;align-items:center;justify-content:center;font:600 11px system-ui">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

/**
 * Standard OpenStreetMap tiles (no key needed), darkened to match the site
 * with a CSS filter on the tile layer only, so routes and pins keep their colours.
 */
function Tiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      className="trip-map-tiles"
    />
  );
}

/** Zooms to fit the given points whenever they change. */
function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    const pts = JSON.parse(key) as [number, number][];
    if (pts.length === 1) map.setView(pts[0], 12);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 13 });
  }, [key, map]);
  return null;
}

function useMapData(src: string) {
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    let tries = 0;
    async function load() {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error();
        const d = (await res.json()) as MapData;
        if (stop) return;
        setData(d);
        // Places and routes not looked up yet: ask again shortly for the next few.
        if (d.pending > 0 && ++tries < 20) setTimeout(load, 1500);
      } catch {
        if (!stop) setFailed(true);
      }
    }
    load();
    return () => {
      stop = true;
    };
  }, [src]);
  return { data, failed };
}

/** One trip: numbered stops coloured by day, roads between them, and the legs listed underneath. */
export function TripMap({ tripId, dates, tripName = "trip" }: { tripId: number; dates: string[]; tripName?: string }) {
  const { data, failed } = useMapData(`/api/trips/${tripId}/map`);
  // Each day its own colour; a leg takes the colour of the day it arrives.
  const dayColor = (d: string) => colorAt(Math.max(0, dates.indexOf(d)));
  // Click a day in the legend to see just that day's route.
  const [day, setDay] = useState<string | null>(null);
  // The stop list starts compact (name + drive time); details on request.
  const [details, setDetails] = useState(false);
  const points = useMemo(
    () => (data?.stops ?? []).filter((s) => !day || onDay(s, day)).map((s) => [s.lat, s.lng] as [number, number]),
    [data, day]
  );

  if (failed) return <p className="text-sm text-faint">Couldn&apos;t load the map right now.</p>;
  if (!data) return <p className="text-sm text-faint">Loading map…</p>;
  if (data.stops.length === 0) {
    return (
      <p className="text-sm text-faint">
        {data.pending > 0 ? "Finding places…" : "Add a 📍 location to events, or a stay to a day (in Edit), and they'll show up here, with the roads between them."}
      </p>
    );
  }
  const driving = data.legs.filter((l) => l.mode === "drive");
  const totalMin = driving.reduce((s, l) => s + (l.minutes ?? 0), 0);
  const totalKm = driving.reduce((s, l) => s + l.km, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="isolate h-[360px] overflow-hidden rounded-md border border-line sm:h-[420px]">
        <MapContainer center={points[0]} zoom={10} scrollWheelZoom={false} className="h-full w-full" style={{ background: "#0d1110" }}>
          <Tiles />
          <Fit points={points} />
          {/*
            Roads driven on several days would hide each other, so earlier days are drawn wider
            underneath and later days narrower on top: a shared road shows every day's colour as a stripe.
            A picked day is drawn last at full width.
          */}
          {data.legs
            .map((l, i) => ({ l, i }))
            .sort((a, b) => Number(a.l.date === day) - Number(b.l.date === day))
            .map(({ l, i }) => (
              <LegLine
                key={i}
                leg={l}
                color={dayColor(l.date)}
                faded={!!day && l.date !== day}
                weight={day ? (l.date === day ? 5 : 3) : Math.max(3, 11 - 2.5 * dates.indexOf(l.date))}
              />
            ))}
          {data.stops.map((s, i) => (
            <Marker key={i} position={[s.lat, s.lng]} icon={numberIcon(i + 1, dayColor(s.date))} opacity={day && !onDay(s, day) ? 0.35 : 1}>
              <Popup>
                <StopPopup stop={s} />
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {dates
            .filter((d) => data.stops.some((s) => onDay(s, d)))
            .map((d) => (
              <button
                key={d}
                onClick={() => setDay(day === d ? null : d)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  day === d ? "border-prose text-prose" : day ? "border-line text-faint" : "border-line text-subtle hover:text-prose"
                }`}
              >
                <span className="h-2 w-4 rounded-full" style={{ background: dayColor(d) }} />
                Day {dates.indexOf(d) + 1} · {shortDate(d, true)}
              </button>
            ))}
          {day && (
            <button className="text-xs text-faint hover:text-prose" onClick={() => setDay(null)}>
              all days
            </button>
          )}
        </div>
        {driving.length > 0 && (
          <p className="text-xs text-faint">
            Driving in total: <span className="text-subtle">{duration(totalMin)}</span> · {miles(totalKm)}
          </p>
        )}
        <ol className={`flex flex-col ${details ? "gap-1.5" : "gap-1"}`}>
          {data.stops.map((s, i) => {
            // One trip, so leg i-1 always joins stop i-1 to stop i.
            const leg = i > 0 ? data.legs[i - 1] : undefined;
            const legText = leg
              ? leg.mode === "drive"
                ? `🚗 ${duration(leg.minutes ?? 0)}`
                : leg.mode === "flight"
                  ? "✈️"
                  : `${miles(leg.km)}`
              : "";
            return (
              <li key={i} className={`flex flex-col ${day && !onDay(s, day) ? "opacity-40" : ""}`}>
                {details && leg && (
                  <span className="ml-7 text-xs text-faint">
                    {leg.mode === "drive"
                      ? `🚗 ${duration(leg.minutes ?? 0)} · ${miles(leg.km)}`
                      : leg.mode === "flight"
                        ? `✈️ ${miles(leg.km)} (straight line)`
                        : `↓ ${miles(leg.km)} (straight line)`}
                  </span>
                )}
                <span className="flex items-baseline gap-2">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                    style={{ background: dayColor(s.date), color: "#0d1110" }}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-prose">{s.titles.join(", ")}</span>
                      {!details && legText && <span className="ml-auto shrink-0 text-xs text-faint">{legText}</span>}
                    </span>
                    {details && (
                      <span className="block truncate text-xs text-faint" title={s.location}>
                        {when(s)} · {s.location}
                      </span>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <button className="w-fit text-xs text-faint hover:text-prose" onClick={() => setDetails(!details)}>
          {details ? "fewer details" : "show times & addresses"}
        </button>
        <TakeAlong data={data} dates={dates} day={day} tripName={tripName} />
        <MapNotes data={data} />
      </div>
    </div>
  );
}

function LegLine({ leg, color, faded = false, weight = 4 }: { leg: Leg; color: string; faded?: boolean; weight?: number }) {
  const opacity = faded ? 0.35 : 0.9;
  if (leg.mode === "drive") return <Polyline positions={leg.path} pathOptions={{ color, weight, opacity }} />;
  return (
    <Polyline
      positions={leg.path}
      pathOptions={{ color: leg.mode === "flight" ? FLIGHT : color, weight: 2, opacity, dashArray: leg.mode === "flight" ? "6 8" : "2 6" }}
    />
  );
}

function StopPopup({ stop }: { stop: Stop }) {
  return (
    <div className="text-xs">
      <strong>{stop.titles.join(", ")}</strong>
      <br />
      {when(stop)}
      <br />
      {stop.location}
    </div>
  );
}

function MapNotes({ data }: { data: MapData }) {
  return (
    <>
      {data.pending > 0 && <p className="text-xs text-faint">Finding {data.pending} more place{data.pending === 1 ? "" : "s"} and roads…</p>}
      {data.missing.length > 0 && (
        <p className="text-xs text-[#e0a63a]">
          Couldn&apos;t find {data.missing.map((m) => `“${m}”`).join(", ")} — try adding the city.
        </p>
      )}
    </>
  );
}

/** The stop nearest all of a trip's others: where its pin goes. */
function centralStop(stops: Stop[]): Stop {
  let best = stops[0];
  let bestSum = Infinity;
  for (const s of stops) {
    const sum = stops.reduce((t, o) => t + km(s, o), 0);
    if (sum < bestSum) {
      best = s;
      bestSum = sum;
    }
  }
  return best;
}

/**
 * The Trips page map: one pin per trip (at its central stop, its colour,
 * faded once it's past). Click a trip — pin or list — to zoom in and see its
 * stops. Routes are drawn only for trips marked "show this route" on their page.
 */
export function AllTripsMap({ trips, today }: { trips: TripRef[]; today: string }) {
  const { data, failed } = useMapData("/api/map");
  const [focus, setFocus] = useState<number | null>(null);
  const ordered = useMemo(() => [...trips].sort((a, b) => a.start_date.localeCompare(b.start_date)), [trips]);
  const color = (id: number) => colorAt(Math.max(0, ordered.findIndex((t) => t.id === id)));
  const past = (id: number) => {
    const t = trips.find((x) => x.id === id);
    return !t || t.done || t.end_date < today;
  };
  const byTrip = useMemo(() => {
    const m = new Map<number, Stop[]>();
    for (const s of data?.stops ?? []) m.set(s.trip_id, [...(m.get(s.trip_id) ?? []), s]);
    return m;
  }, [data]);
  const points = useMemo(() => {
    if (focus != null) return (byTrip.get(focus) ?? []).map((s) => [s.lat, s.lng] as [number, number]);
    return [...byTrip.values()].map((st) => centralStop(st)).map((s) => [s.lat, s.lng] as [number, number]);
  }, [byTrip, focus]);

  if (failed) return <p className="text-sm text-faint">Couldn&apos;t load the map right now.</p>;
  if (!data) return <p className="text-sm text-faint">Loading map…</p>;
  if (data.stops.length === 0) {
    return (
      <p className="text-sm text-faint">
        {data.pending > 0 ? "Finding places…" : "Add 📍 locations to trip events and every trip shows up here."}
      </p>
    );
  }
  const listed = ordered.filter((t) => byTrip.has(t.id));
  const nameOf = (id: number) => trips.find((t) => t.id === id)?.name ?? "";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      <div className="isolate h-[380px] overflow-hidden rounded-md border border-line sm:h-[440px]">
        <MapContainer center={points[0] ?? [data.stops[0].lat, data.stops[0].lng]} zoom={5} scrollWheelZoom={false} className="h-full w-full" style={{ background: "#0d1110" }}>
          <Tiles />
          <Fit points={points} />
          {/* Routes only where asked for, and only for the focused trip when one is picked. */}
          {data.legs
            .filter((l) => focus == null || l.trip_id === focus)
            .map((l, i) => (
              <LegLine key={i} leg={l} color={color(l.trip_id)} faded={past(l.trip_id)} />
            ))}
          {focus == null
            ? [...byTrip.entries()].map(([id, stops]) => {
                const c = centralStop(stops);
                const dim = past(id);
                return (
                  <CircleMarker
                    key={id}
                    center={[c.lat, c.lng]}
                    radius={9}
                    eventHandlers={{ click: () => setFocus(id) }}
                    pathOptions={{ color: "#deeade", weight: 2, fillColor: color(id), fillOpacity: dim ? 0.4 : 1, opacity: dim ? 0.5 : 1 }}
                  >
                    <Tooltip direction="top" offset={[0, -8]}>
                      {nameOf(id)} · {stops.length} place{stops.length === 1 ? "" : "s"}
                    </Tooltip>
                  </CircleMarker>
                );
              })
            : (byTrip.get(focus) ?? []).map((s, i) => (
                <CircleMarker
                  key={i}
                  center={[s.lat, s.lng]}
                  radius={6}
                  pathOptions={{ color: "#deeade", weight: 1.5, fillColor: color(focus), fillOpacity: 1 }}
                >
                  <Popup>
                    <StopPopup stop={s} />
                  </Popup>
                </CircleMarker>
              ))}
        </MapContainer>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {focus != null && (
          <li className="mb-1 flex items-center justify-between gap-2">
            <button className="text-xs text-faint hover:text-prose" onClick={() => setFocus(null)}>
              ← all trips
            </button>
            <a href={`/trips/${focus}`} className="text-xs text-faint hover:text-prose">
              open trip →
            </a>
          </li>
        )}
        {listed.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setFocus(focus === t.id ? null : t.id)}
              className={`flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-lift/50 ${focus === t.id ? "bg-lift" : ""}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(t.id), opacity: past(t.id) ? 0.4 : 1 }} />
              <span className={`truncate ${past(t.id) ? "text-faint" : "text-subtle"}`}>{t.name}</span>
              {t.show_route && <span className="shrink-0 text-[10px] text-faint" title="Route shown on this map">route</span>}
              <span className="ml-auto shrink-0 text-xs text-faint">{shortDate(t.start_date)}</span>
            </button>
          </li>
        ))}
        <li className="mt-1 text-[11px] leading-snug text-faint">
          One pin per trip — click one to see its places. Routes show for trips marked on their own page.
        </li>
        <li>
          <MapNotes data={data} />
        </li>
      </ul>
    </div>
  );
}

// ---- Taking a day's route into Google Maps / Apple Maps ----

type Mode = "driving" | "walking" | "transit";
const MODES: { key: Mode; label: string; apple: string }[] = [
  { key: "driving", label: "🚗 Drive", apple: "d" },
  { key: "walking", label: "🚶 Walk", apple: "w" },
  { key: "transit", label: "🚆 Transit", apple: "r" },
];
/** Google Maps takes at most 9 stops between the start and the end of one link. */
const GOOGLE_STOPS = 11;

const ll = (s: Stop) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;

/** Google Maps directions through these stops in order (opens the app on phones). */
function googleRoute(stops: Stop[], mode: Mode) {
  const q = new URLSearchParams({ api: "1", origin: ll(stops[0]), destination: ll(stops[stops.length - 1]), travelmode: mode });
  if (stops.length > 2) q.set("waypoints", stops.slice(1, -1).map(ll).join("|"));
  return `https://www.google.com/maps/dir/?${q}`;
}
/** Directions from wherever you are to one stop. */
const googleTo = (s: Stop, mode: Mode) => `https://www.google.com/maps/dir/?api=1&destination=${ll(s)}&travelmode=${mode}`;
const appleTo = (s: Stop, mode: Mode) =>
  `https://maps.apple.com/?daddr=${ll(s)}&dirflg=${MODES.find((m) => m.key === mode)!.apple}&q=${encodeURIComponent(s.titles.join(", "))}`;

/** Stops in runs that can be routed by road: a flight between two stops starts a new run. */
function runs(stops: { s: Stop; i: number }[], legs: Leg[]) {
  const out: Stop[][] = [];
  for (const { s, i } of stops) {
    const leg = i > 0 ? legs[i - 1] : undefined;
    const last = out[out.length - 1];
    if (!last || leg?.mode === "flight" || !stops.some((x) => x.i === i - 1)) out.push([s]);
    else last.push(s);
  }
  // Long runs are split across links, each starting where the last ended.
  return out.flatMap((run) => {
    if (run.length <= GOOGLE_STOPS) return [run];
    const parts: Stop[][] = [];
    for (let k = 0; k < run.length - 1; k += GOOGLE_STOPS - 1) parts.push(run.slice(k, k + GOOGLE_STOPS));
    return parts;
  });
}

const xml = (t: string) => t.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** A KML file of the stops (numbered pins) and the roads between them: Google My Maps, Google Earth and most map apps open it. */
function kml(name: string, stops: { s: Stop; i: number }[], legs: Leg[]) {
  const pins = stops.map(
    ({ s, i }) => `  <Placemark>
    <name>${i + 1}. ${xml(s.titles.join(", "))}</name>
    <description>${xml(`${when(s)} · ${s.location}`)}</description>
    <Point><coordinates>${s.lng},${s.lat},0</coordinates></Point>
  </Placemark>`
  );
  const lines = legs.map(
    (l) => `  <Placemark>
    <name>${xml(`${l.from} → ${l.to}`)}</name>
    <styleUrl>#road</styleUrl>
    <LineString><tessellate>1</tessellate><coordinates>${l.path.map(([lat, lng]) => `${lng},${lat},0`).join(" ")}</coordinates></LineString>
  </Placemark>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${xml(name)}</name>
  <Style id="road"><LineStyle><color>ffe58739</color><width>4</width></LineStyle></Style>
${[...pins, ...lines].join("\n")}
</Document>
</kml>
`;
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileSafe = (t: string) => t.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "trip";

/**
 * The picked day (or the whole trip) as something to use on the go: the
 * route in Google Maps, directions to each stop in Google or Apple Maps, a
 * KML file for Google My Maps, or the list as text.
 */
function TakeAlong({ data, dates, day, tripName }: { data: MapData; dates: string[]; day: string | null; tripName: string }) {
  const [mode, setMode] = useState<Mode>("driving");
  const [copied, setCopied] = useState(false);
  const stops = data.stops.map((s, i) => ({ s, i })).filter(({ s }) => !day || onDay(s, day));
  if (!stops.length) return null;
  const legs = data.legs.filter((_, k) => stops.some((x) => x.i === k + 1) && stops.some((x) => x.i === k));
  const label = day ? `Day ${dates.indexOf(day) + 1} · ${shortDate(day, true)}` : "Whole trip";
  const routes = day ? runs(stops, data.legs).filter((r) => r.length > 1) : [];
  const text = stops
    .map(({ s, i }) => `${i + 1}. ${s.titles.join(", ")} — ${when(s)}\n   ${s.location} (${ll(s)})`)
    .join("\n");

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">Take it with you · {label}</h3>
        <div className="flex rounded border border-line p-0.5 text-[11px]">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`rounded px-1.5 py-0.5 transition-colors ${mode === m.key ? "bg-lift text-prose" : "text-faint hover:text-subtle"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!day && <p className="text-xs text-faint">Pick a day above to open its route in Google Maps, step by step.</p>}
      {day && routes.length > 0 && mode !== "transit" && (
        <div className="flex flex-wrap gap-1.5">
          {routes.map((r, k) => (
            <a
              key={k}
              href={googleRoute(r, mode)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-accent-dim px-2.5 py-1 text-xs text-prose transition-colors hover:brightness-110"
            >
              Open {routes.length > 1 ? `part ${k + 1} (${r.length} stops)` : `the day's ${r.length} stops`} in Google Maps ↗
            </a>
          ))}
        </div>
      )}
      {day && mode === "transit" && routes.length > 0 && (
        <p className="text-xs text-faint">Transit directions go one stop at a time: use the links below as you go.</p>
      )}
      {day && (
        <ol className="flex flex-col gap-1 text-xs">
          {stops.map(({ s, i }) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right text-faint">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-subtle" title={s.location}>
                {s.titles.join(", ")}
              </span>
              <span className="shrink-0 text-faint">directions:</span>
              <a href={googleTo(s, mode)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-subtle underline decoration-line underline-offset-2 hover:text-prose">
                Google
              </a>
              <a href={appleTo(s, mode)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-subtle underline decoration-line underline-offset-2 hover:text-prose">
                Apple
              </a>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <button
          className="text-faint hover:text-prose"
          title="Import into Google My Maps (mymaps.google.com → Create a new map → Import), then find it in the Google Maps app under Saved → Maps"
          onClick={() =>
            download(`${fileSafe(tripName)}${day ? `-day-${dates.indexOf(day) + 1}` : ""}.kml`, kml(`${tripName} · ${label}`, stops, legs), "application/vnd.google-earth.kml+xml")
          }
        >
          ⬇ KML file (Google My Maps)
        </button>
        <button
          className="text-faint hover:text-prose"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${tripName} · ${label}\n${text}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Clipboard blocked: nothing to do.
            }
          }}
        >
          {copied ? "✓ copied" : "⧉ copy list"}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-faint">
        Google Maps links open the app on your phone with every stop in order. Apple Maps and Google links per stop give directions from
        where you are. The KML file brings the pins and roads into Google My Maps (then Google Maps → Saved → Maps).
      </p>
    </div>
  );
}
