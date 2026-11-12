# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Travel budget

Standalone app served at **https://travel.jascui.com** (moved out of `photography-site-next`, where it lived at `/travel_budget`, on 2026-11-07).

- Pages: `/` (budget), `/trips` (planner, calendar, map), `/trips/<id>` (hourly trip calendar), `/login`.
- API: `/api/*`. `/api/travel/*` is rewritten to `/api/*` (`next.config.ts`) because Llamabear's feed (`/api/travel/feed`), `trip_planning` and older calendar subscriptions still use the old prefix — don't drop that rewrite without updating them.
- Login is username/password (`lib/auth.ts`). Logins are scrypt hashes in the database's `travel_users` table; set one with `node scripts/set-password.mjs <user> --env .env.travel-prod` (takes effect immediately). A user not in that table falls back to the `TRAVEL_USERS` env var. Failed sign-ins log the reason (no login stored / wrong password) in the Vercel function logs.
- Data is in its own Turso database (`TRAVEL_DATABASE_URL`/`TRAVEL_DATABASE_AUTH_TOKEN` in Vercel); locally it falls back to `.data/travel.db`.
- Trip maps and weather call free, keyless services (OpenStreetMap Nominatim for places, the OSRM demo server for driving routes, Open-Meteo for forecasts, OpenStreetMap tiles); places and routes are cached in `geocode_cache`/`route_cache` (`lib/geo.ts`).
- Events can carry a pin (`trip_events.lat`/`lng`, set by dropping a pin, picking a search suggestion, or pasting a Google/Apple Maps link or coordinates). A pin is used as is instead of looking up the location text (also coordinates in an event's map link). `/api/resolve-link` follows short Google share links (`maps.app.goo.gl`) server-side to read their coordinates; it only follows Google/Apple maps hosts (`lib/coords.ts` parses links).
- The trip map's "Take it with you" panel turns a day into a Google Maps multi-stop directions link (split every 11 stops and at flights), per-stop Google/Apple directions links, a KML download (for Google My Maps) and a copyable list.
- Each trip's calendar feed (`/api/trips/<id>/calendar.ics`) is readable with a per-trip token derived from `TRAVEL_SESSION_SECRET`, so changing that secret breaks existing Google/Apple calendar subscriptions. Event UIDs use the fixed host `travel.photographyjson.com` so they stay stable across the domain move.
- `scripts/import.mjs --env .env.travel-prod` targets the production database — never run it with `--replace` there without asking, since that wipes live data.
