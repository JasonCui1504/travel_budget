"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { coordsFrom, isShortMapsLink, type LatLng } from "@/lib/coords";
import { inputCls } from "../../api";

// A small map for dropping an event's pin by hand, for places the search
// can't find. Click (or tap) to put the pin down, drag it to adjust, paste
// coordinates or a Google/Apple Maps link, or use where you are now.

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="width:26px;height:26px;transform:translateY(-12px);font-size:24px;line-height:26px;text-align:center;filter:drop-shadow(0 1px 1px #0008)">📍</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/** Clicks put the pin down. */
function Clicks({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }) });
  return null;
}

/** Moves the view when `to` changes (a pasted link, a search pick, your location). */
function Follow({ to, zoom }: { to: LatLng | null; zoom: number }) {
  const map = useMap();
  const key = to ? `${to.lat},${to.lng}` : "";
  useEffect(() => {
    if (!key) return;
    const [lat, lng] = key.split(",").map(Number);
    map.setView([lat, lng], Math.max(map.getZoom(), zoom));
  }, [key, zoom, map]);
  return null;
}

export default function PinPicker({
  value,
  onChange,
  tripId,
  near,
}: {
  value: LatLng | null;
  onChange: (p: LatLng | null) => void;
  tripId: number;
  /** Where to start looking when there's no pin yet (e.g. a picked search result). */
  near: LatLng | null;
}) {
  const [start, setStart] = useState<LatLng | null>(value ?? near);
  const [jump, setJump] = useState<LatLng | null>(null);
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");

  // No pin and nothing to start from: open over the trip's other places.
  useEffect(() => {
    if (start) return;
    let stop = false;
    fetch(`/api/trips/${tripId}/map`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stops?: LatLng[] } | null) => {
        if (stop) return;
        const s = d?.stops ?? [];
        setStart(s.length ? { lat: s.reduce((t, p) => t + p.lat, 0) / s.length, lng: s.reduce((t, p) => t + p.lng, 0) / s.length } : { lat: 30, lng: 0 });
      })
      .catch(() => !stop && setStart({ lat: 30, lng: 0 }));
    return () => {
      stop = true;
    };
  }, [start, tripId]);

  const put = (p: LatLng) => {
    setNote("");
    onChange(p);
  };

  async function applyPasted() {
    const text = paste.trim();
    if (!text) return;
    setNote(isShortMapsLink(text) ? "Reading the link…" : "");
    const p = await coordsFrom(text);
    if (!p) {
      setNote("Couldn't find coordinates in that. In Google Maps, press and hold the spot, then copy the numbers it shows (like 35.0037, 135.7681).");
      return;
    }
    put(p);
    setJump(p);
    setPaste("");
  }

  function hereNow() {
    if (!navigator.geolocation) return setNote("This browser can't share your location.");
    setNote("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) };
        put(p);
        setJump(p);
      },
      () => setNote("Couldn't get your location (permission denied or unavailable)."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-2">
      <div className="isolate h-64 overflow-hidden rounded border border-line">
        {start ? (
          <MapContainer center={[start.lat, start.lng]} zoom={value || near ? 16 : 12} className="h-full w-full" style={{ background: "#0d1110" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              className="trip-map-tiles"
            />
            <Clicks onPick={put} />
            <Follow to={jump} zoom={16} />
            {value && (
              <Marker
                position={[value.lat, value.lng]}
                icon={pinIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    put({ lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
                  },
                }}
              />
            )}
          </MapContainer>
        ) : (
          <p className="p-3 text-sm text-faint">Loading map…</p>
        )}
      </div>
      <p className="text-[11px] leading-snug text-faint">
        Click the map to drop the pin; drag it to fine-tune. Or paste coordinates or a Google / Apple Maps link:
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyPasted();
            }
          }}
          placeholder="35.0037, 135.7681 or https://maps.app.goo.gl/…"
          className={`${inputCls} min-w-0 flex-1 py-1 text-xs`}
          aria-label="Coordinates or maps link"
        />
        <button type="button" onClick={applyPasted} className="rounded border border-line px-2 py-1 text-xs text-subtle hover:text-prose">
          Use
        </button>
        <button type="button" onClick={hereNow} className="rounded border border-line px-2 py-1 text-xs text-subtle hover:text-prose">
          📍 Where I am
        </button>
      </div>
      {note && <p className="text-[11px] leading-snug text-[#e0a63a]">{note}</p>}
    </div>
  );
}
