# Llama + Shrimp Travels

Travel budget and trip planner, deployed at **https://travel.jascui.com**.

- **Budget** (`/`): monthly unlock pool, expenses, per-trip and per-category spend, to-dos.
- **Trips** (`/trips`): upcoming-trip planner, year calendar, map of all trips.
- **Trip** (`/trips/<id>`): hourly itinerary calendar, flights, stays, map with routes, weather, estimated costs, ideas, calendar (.ics) export/subscription.

## Local development

```bash
npm install
cp .env.example .env.local   # set TRAVEL_SESSION_SECRET at minimum
node scripts/set-password.mjs <username>
npm run dev
```

Without `TRAVEL_DATABASE_URL` the app uses a local SQLite file at `.data/travel.db`.

## Deploying to travel.jascui.com (Vercel)

1. Import this repo as a new Vercel project (framework: Next.js).
2. Copy the env vars from the old `photography-site-next` project: `TRAVEL_SESSION_SECRET`, `TRAVEL_DATABASE_URL`, `TRAVEL_DATABASE_AUTH_TOKEN`, `TRAVEL_FEED_SECRET` (and `TRAVEL_USERS` if used). Reusing the same session secret and database keeps logins, data and calendar-feed tokens intact.
3. Project → Settings → Domains → add `travel.jascui.com`, then add the DNS record Vercel shows (a `CNAME` for `travel` → `cname.vercel-dns.com`) at your DNS provider.

See `AGENTS.md` for more operational notes.
