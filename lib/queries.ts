import { airport } from "./airports";
import { getTravelDb, type EventStatus } from "./db";
import { instantOf, validZone } from "./time";

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export type Person = { id: number; slug: string; name: string; contribution: number };
export type Cycle = { id: number; start_month: string; end_month: string };
export type Expense = {
  id: number;
  person_id: number;
  month: string;
  category: string;
  kind: "travel" | "visiting";
  amount: number;
  notes: string;
  trip_id: number | null;
  /** Flights only: the route, and 1 round trip / 0 one way (null when not recorded). */
  flight_from: string;
  flight_to: string;
  round_trip: number | null;
  /** When the expense was first logged (UTC, "YYYY-MM-DD HH:MM:SS"); edits leave it alone. */
  created_at: string;
};
export type Trip = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  done: boolean;
  notes: string;
  doc: string;
  /** Hours shown in view mode; null means fit to the events. */
  view_start_hour: number | null;
  view_end_hour: number | null;
  /** IANA zone the trip's times are in (e.g. "America/New_York"); "" = not set. */
  time_zone: string;
  /** Draw the route on the Trips page map. */
  show_route: boolean;
  /** The trip page's map is switched off. */
  hide_map: boolean;
};
/** A to-do from the budget page, with an optional cost estimate and trip. */
export type Todo = {
  id: number;
  text: string;
  cost: number | null;
  trip_id: number | null;
  trip_name: string;
  done: boolean;
};
export type TripEvent = {
  id: number;
  trip_id: number;
  date: string;
  start_hour: number;
  end_hour: number;
  title: string;
  status: EventStatus;
  notes: string;
  location: string;
  map_link: string;
  reservation_link: string;
  other_link: string;
  /** Where the event's pin is, when one was dropped or a suggestion picked; else the location text is looked up. */
  lat: number | null;
  lng: number | null;
  /** Transit events: each traveller's flight. */
  flights: Flight[];
};
export type Flight = {
  id: number;
  event_id: number;
  person_id: number;
  flight_no: string;
  from_code: string;
  to_code: string;
  /** "YYYY-MM-DDTHH:MM", local at each airport (as on the ticket). */
  depart: string;
  arrive: string;
  /** Looked up from the codes: time zones and cities. */
  from_tz: string;
  to_tz: string;
  from_city: string;
  to_city: string;
};
export type TripDay = {
  date: string;
  accommodation: string;
  accommodation_status: string;
  notes: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  /** Old free-text policy, kept for display; new stays use cancel_by / non_refundable. */
  cancellation_policy: string;
  stay_link: string;
  /** The stay's address, for the map; "" = find it by its name. */
  stay_address: string;
  /** Last day to cancel for free (YYYY-MM-DD), or "". */
  cancel_by: string;
  non_refundable: boolean;
  /** Car rental for the day, set up like the stay. */
  car: string;
  car_status: string;
  car_cancel_by: string;
  car_non_refundable: boolean;
  car_link: string;
  car_notes: string;
};
export type TripIdea = { id: number; trip_id: number; text: string };
/** A cost expected on a trip, before it's paid and logged as an expense. */
export type EstimatedExpense = { id: number; trip_id: number; item: string; category: string; amount: number };

export const CATEGORIES = ["Flights", "Hotels", "Dates", "Car", "Other Transportation", "Other"];

/** Every month from start to end inclusive, as YYYY-MM. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  for (let month = start; month <= end && out.length < 36; ) {
    out.push(month);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    month = `${y}-${String(m).padStart(2, "0")}`;
  }
  return out;
}

export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export type Estimate = { id: number; category: string; cost: number; whom: string };

export async function listEstimates(): Promise<Estimate[]> {
  const db = await getTravelDb();
  const rs = await db.execute("SELECT * FROM estimates ORDER BY sort, id");
  return rs.rows.map((r) => ({ id: num(r.id), category: str(r.category), cost: num(r.cost), whom: str(r.whom) }));
}

export async function listPeople(): Promise<Person[]> {
  const db = await getTravelDb();
  const rs = await db.execute("SELECT * FROM people ORDER BY sort, id");
  return rs.rows.map((r) => ({
    id: num(r.id),
    slug: str(r.slug),
    name: str(r.name),
    contribution: num(r.contribution),
  }));
}

/** The current cycle: the latest one, created on first use if none exists. */
export async function getCycle(): Promise<Cycle> {
  const db = await getTravelDb();
  const rs = await db.execute("SELECT * FROM cycles ORDER BY start_month DESC LIMIT 1");
  if (rs.rows.length > 0) {
    const r = rs.rows[0];
    return { id: num(r.id), start_month: str(r.start_month), end_month: str(r.end_month) };
  }
  // Default to the September → June year containing today.
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const start = `${startYear}-09`;
  const end = `${startYear + 1}-06`;
  const ins = await db.execute({
    sql: "INSERT INTO cycles (start_month, end_month) VALUES (?, ?) RETURNING id",
    args: [start, end],
  });
  return { id: num(ins.rows[0].id), start_month: start, end_month: end };
}

export async function getUnlocks(): Promise<Map<string, boolean>> {
  const db = await getTravelDb();
  const rs = await db.execute("SELECT person_id, month, unlocked FROM month_unlocks");
  return new Map(rs.rows.map((r) => [`${num(r.person_id)}|${str(r.month)}`, num(r.unlocked) === 1]));
}

export async function listExpenses(): Promise<Expense[]> {
  const db = await getTravelDb();
  const rs = await db.execute("SELECT * FROM expenses ORDER BY month DESC, id DESC");
  return rs.rows.map((r) => ({
    id: num(r.id),
    person_id: num(r.person_id),
    month: str(r.month),
    category: str(r.category),
    kind: str(r.kind) as Expense["kind"],
    amount: num(r.amount),
    notes: str(r.notes),
    trip_id: r.trip_id == null ? null : num(r.trip_id),
    flight_from: str(r.flight_from),
    flight_to: str(r.flight_to),
    round_trip: r.round_trip == null ? null : num(r.round_trip),
    created_at: str(r.created_at),
  }));
}

export type PersonSummary = {
  person: Person;
  unlocked: number;
  spent: number;
  remaining: number;
  /** Per month in the cycle: unlocked flag, spent, and what's left of the contribution. */
  months: { month: string; unlocked: boolean; spent: number; leftOver: number }[];
};

export type BudgetSummary = {
  cycle: Cycle;
  months: string[];
  people: PersonSummary[];
  unlockedPool: number;
  fullYearPool: number;
  spent: number;
  remaining: number;
  travel: number;
  visiting: number;
  /** The last month unlocked for everyone, or "" when none is. */
  unlockedThrough: string;
  /** Per trip, split by expense type (category → amount). */
  byTrip: {
    trip_id: number | null;
    name: string;
    start_date: string;
    end_date: string;
    total: number;
    categories: Record<string, number>;
  }[];
  byCategory: { category: string; total: number; count: number }[];
};

/**
 * The BUDGET sheet's maths. Each person's pool is their contribution times
 * the months they've unlocked; a month's left-over can go negative as long
 * as the pool as a whole holds. Travel vs visiting is split by kind.
 */
export async function getBudgetSummary(): Promise<BudgetSummary> {
  const [cycle, people, unlocks, expenses] = await Promise.all([
    getCycle(),
    listPeople(),
    getUnlocks(),
    listExpenses(),
  ]);
  const months = monthsBetween(cycle.start_month, cycle.end_month);
  const inCycle = expenses.filter((e) => e.month >= cycle.start_month && e.month <= cycle.end_month);

  const summaries = people.map((person) => {
    const rows = months.map((month) => {
      const unlocked = unlocks.get(`${person.id}|${month}`) ?? false;
      const spent = inCycle
        .filter((e) => e.person_id === person.id && e.month === month)
        .reduce((s, e) => s + e.amount, 0);
      return { month, unlocked, spent, leftOver: person.contribution - spent };
    });
    const unlocked = rows.filter((r) => r.unlocked).length * person.contribution;
    const spent = inCycle.filter((e) => e.person_id === person.id).reduce((s, e) => s + e.amount, 0);
    return { person, unlocked, spent, remaining: unlocked - spent, months: rows };
  });

  const unlockedPool = summaries.reduce((s, p) => s + p.unlocked, 0);
  const unlockedThrough =
    [...months].reverse().find((m) => summaries.every((p) => p.months.find((r) => r.month === m)?.unlocked)) ?? "";

  // Spending per trip (expenses not linked to a trip grouped together) and per category.
  const trips = await listTrips();
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const tripTotals = new Map<number | null, { total: number; categories: Record<string, number> }>();
  const catTotals = new Map<string, { total: number; count: number }>();
  for (const e of inCycle) {
    const key = e.trip_id != null && tripById.has(e.trip_id) ? e.trip_id : null;
    const cat = e.category.trim() || "Other";
    const t = tripTotals.get(key) ?? { total: 0, categories: {} };
    t.total += e.amount;
    t.categories[cat] = (t.categories[cat] ?? 0) + e.amount;
    tripTotals.set(key, t);
    const c = catTotals.get(cat) ?? { total: 0, count: 0 };
    c.total += e.amount;
    c.count += 1;
    catTotals.set(cat, c);
  }
  const byTrip = [...tripTotals.entries()]
    .map(([trip_id, t]) => {
      const trip = trip_id == null ? null : tripById.get(trip_id)!;
      return { trip_id, name: trip?.name ?? "", start_date: trip?.start_date ?? "", end_date: trip?.end_date ?? "", ...t };
    })
    .sort((a, b) => (a.trip_id == null ? 1 : b.trip_id == null ? -1 : b.total - a.total));
  const byCategory = [...catTotals.entries()]
    .map(([category, c]) => ({ category, ...c }))
    .sort((a, b) => b.total - a.total);
  const spent = summaries.reduce((s, p) => s + p.spent, 0);
  return {
    cycle,
    months,
    people: summaries,
    unlockedPool,
    fullYearPool: people.reduce((s, p) => s + p.contribution, 0) * months.length,
    spent,
    remaining: unlockedPool - spent,
    travel: inCycle.filter((e) => e.kind === "travel").reduce((s, e) => s + e.amount, 0),
    visiting: inCycle.filter((e) => e.kind === "visiting").reduce((s, e) => s + e.amount, 0),
    unlockedThrough,
    byTrip,
    byCategory,
  };
}

function rowToTrip(r: Record<string, unknown>): Trip {
  return {
    id: num(r.id),
    name: str(r.name),
    start_date: str(r.start_date),
    end_date: str(r.end_date),
    done: num(r.done) === 1,
    notes: str(r.notes),
    doc: str(r.doc),
    view_start_hour: r.view_start_hour == null ? null : num(r.view_start_hour),
    view_end_hour: r.view_end_hour == null ? null : num(r.view_end_hour),
    time_zone: str(r.time_zone),
    show_route: num(r.show_route) === 1,
    hide_map: num(r.hide_map) === 1,
  };
}

export async function listTrips(): Promise<(Trip & { spent: number })[]> {
  const db = await getTravelDb();
  const rs = await db.execute(
    `SELECT t.*, COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.trip_id = t.id), 0) AS spent
     FROM trips t ORDER BY start_date DESC, id DESC`
  );
  return rs.rows.map((r) => ({ ...rowToTrip(r), spent: num(r.spent) }));
}

export async function getTrip(id: number): Promise<{
  trip: Trip;
  events: TripEvent[];
  days: TripDay[];
  expenses: (Expense & { person_name: string })[];
  ideas: TripIdea[];
  estimates: EstimatedExpense[];
} | null> {
  const db = await getTravelDb();
  const t = await db.execute({ sql: "SELECT * FROM trips WHERE id = ?", args: [id] });
  if (t.rows.length === 0) return null;
  const [events, days, expenses, ideas, flights, estimates] = await Promise.all([
    db.execute({ sql: "SELECT * FROM trip_events WHERE trip_id = ? ORDER BY date, start_hour", args: [id] }),
    db.execute({ sql: "SELECT * FROM trip_days WHERE trip_id = ? ORDER BY date", args: [id] }),
    db.execute({
      sql: `SELECT e.*, p.name AS person_name FROM expenses e JOIN people p ON p.id = e.person_id
            WHERE e.trip_id = ? ORDER BY e.month, e.id`,
      args: [id],
    }),
    db.execute({ sql: "SELECT id, trip_id, text FROM trip_idea_items WHERE trip_id = ? ORDER BY id", args: [id] }),
    db.execute({
      sql: `SELECT f.* FROM trip_flights f JOIN trip_events e ON e.id = f.event_id WHERE e.trip_id = ? ORDER BY f.depart, f.id`,
      args: [id],
    }),
    db.execute({ sql: "SELECT * FROM trip_estimated_expenses WHERE trip_id = ? ORDER BY id", args: [id] }),
  ]);
  const flightsByEvent = new Map<number, Flight[]>();
  for (const r of flights.rows) {
    const from = airport(str(r.from_code));
    const to = airport(str(r.to_code));
    const f: Flight = {
      id: num(r.id),
      event_id: num(r.event_id),
      person_id: num(r.person_id),
      flight_no: str(r.flight_no),
      from_code: str(r.from_code),
      to_code: str(r.to_code),
      depart: str(r.depart),
      arrive: str(r.arrive),
      from_tz: from?.tz ?? "",
      to_tz: to?.tz ?? "",
      from_city: from?.city ?? "",
      to_city: to?.city ?? "",
    };
    flightsByEvent.set(f.event_id, [...(flightsByEvent.get(f.event_id) ?? []), f]);
  }
  return {
    trip: rowToTrip(t.rows[0]),
    events: events.rows.map((r) => ({
      id: num(r.id),
      trip_id: num(r.trip_id),
      date: str(r.date),
      start_hour: num(r.start_hour),
      end_hour: num(r.end_hour),
      title: str(r.title),
      status: str(r.status) as EventStatus,
      notes: str(r.notes),
      location: str(r.location),
      map_link: str(r.map_link),
      reservation_link: str(r.reservation_link),
      other_link: str(r.other_link),
      lat: r.lat == null ? null : num(r.lat),
      lng: r.lng == null ? null : num(r.lng),
      flights: flightsByEvent.get(num(r.id)) ?? [],
    })),
    days: days.rows.map((r) => ({
      date: str(r.date),
      accommodation: str(r.accommodation),
      accommodation_status: str(r.accommodation_status),
      notes: str(r.notes),
      breakfast: str(r.breakfast),
      lunch: str(r.lunch),
      dinner: str(r.dinner),
      cancellation_policy: str(r.cancellation_policy),
      stay_link: str(r.stay_link),
      stay_address: str(r.stay_address),
      cancel_by: str(r.cancel_by),
      non_refundable: num(r.non_refundable) === 1,
      car: str(r.car),
      car_status: str(r.car_status),
      car_cancel_by: str(r.car_cancel_by),
      car_non_refundable: num(r.car_non_refundable) === 1,
      car_link: str(r.car_link),
      car_notes: str(r.car_notes),
    })),
    ideas: ideas.rows.map((r) => ({ id: num(r.id), trip_id: num(r.trip_id), text: str(r.text) })),
    estimates: estimates.rows.map((r) => ({
      id: num(r.id),
      trip_id: num(r.trip_id),
      item: str(r.item),
      category: str(r.category),
      amount: num(r.amount),
    })),
    expenses: expenses.rows.map((r) => ({
      id: num(r.id),
      person_id: num(r.person_id),
      month: str(r.month),
      category: str(r.category),
      kind: str(r.kind) as Expense["kind"],
      amount: num(r.amount),
      notes: str(r.notes),
      trip_id: num(r.trip_id),
      flight_from: str(r.flight_from),
      flight_to: str(r.flight_to),
      round_trip: r.round_trip == null ? null : num(r.round_trip),
      created_at: str(r.created_at),
      person_name: str(r.person_name),
    })),
  };
}

export type Planning = {
  /** Per upcoming trip: events marked "Not booked" and stays not confirmed yet. */
  toBook: {
    trip_id: number;
    trip_name: string;
    items: { kind: "event" | "stay" | "car"; label: string; date: string; end_date: string }[];
  }[];
  /** Free-cancellation deadlines from today on, soonest first. */
  deadlines: {
    trip_id: number;
    trip_name: string;
    kind: "stay" | "car";
    /** The stay or rental company. */
    accommodation: string;
    cancel_by: string;
    from: string;
    to: string;
  }[];
  /** When each trip starts, for the countdown (see tripStarts). */
  starts: Record<number, TripStart>;
  /** Open to-dos from the budget page. */
  todos: Todo[];
};

/** To-dos, open ones first (oldest first), then finished ones. */
export async function listTodos(): Promise<Todo[]> {
  const db = await getTravelDb();
  const rs = await db.execute(
    `SELECT d.*, t.name AS trip_name FROM travel_todos d LEFT JOIN trips t ON t.id = d.trip_id
     ORDER BY d.done, d.id`
  );
  return rs.rows.map((r) => ({
    id: num(r.id),
    text: str(r.text),
    cost: r.cost == null ? null : num(r.cost),
    trip_id: r.trip_id == null ? null : num(r.trip_id),
    trip_name: str(r.trip_name),
    done: num(r.done) === 1,
  }));
}

/** When a trip starts: a wall-clock time in a zone ("" = the viewer's own). */
export type TripStart = {
  date: string;
  /** Hours into `date`: 18.5 = 6:30 PM. */
  hour: number;
  tz: string;
  /** Set when it's a flight's departure: the airport code it leaves from. */
  airport: string;
};

/**
 * Each trip's start, by trip id (trips with no events on day one are left
 * out): the earliest event on its first day, where a transit event counts as
 * its earliest flight's actual departure (local time at that airport). Its
 * calendar block isn't used, as it's placed in the trip's zone when saved and
 * drifts if that zone changes later. A flight placed the day before (a
 * late-night departure) counts too.
 */
export async function tripStarts(): Promise<Record<number, TripStart>> {
  const db = await getTravelDb();
  const rs = await db.execute(
    `SELECT t.id, t.time_zone, e.date, e.start_hour, f.from_code, f.depart
     FROM trips t
     JOIN trip_events e ON e.trip_id = t.id
     LEFT JOIN trip_flights f ON f.event_id = e.id
     WHERE e.date = t.start_date OR (e.date = date(t.start_date, '-1 day') AND f.id IS NOT NULL)`
  );
  const best = new Map<number, { at: number; start: TripStart }>();
  for (const r of rs.rows) {
    let start: TripStart;
    if (r.depart != null) {
      const from = airport(str(r.from_code));
      if (!from) continue;
      const depart = str(r.depart);
      start = { date: depart.slice(0, 10), hour: Number(depart.slice(11, 13)) + Number(depart.slice(14, 16)) / 60, tz: from.tz, airport: from.code };
    } else {
      const tz = str(r.time_zone);
      start = { date: str(r.date), hour: num(r.start_hour), tz: validZone(tz) ? tz : "", airport: "" };
    }
    // Only for picking the earliest: a trip with no zone (so no flights) is compared as if in UTC.
    const min = Math.round(start.hour * 60);
    const at = instantOf(`${start.date}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`, start.tz || "UTC");
    const id = num(r.id);
    const cur = best.get(id);
    if (!cur || at < cur.at) best.set(id, { at, start });
  }
  return Object.fromEntries([...best].map(([id, b]) => [id, b.start]));
}

const addDay = (d: string) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);

/** What still needs doing across trips that haven't ended: bookings and cancellation deadlines. */
export async function getPlanning(today: string): Promise<Planning> {
  const db = await getTravelDb();
  const [events, stays, starts, todos] = await Promise.all([
    db.execute({
      sql: `SELECT e.trip_id, t.name AS trip_name, e.date, e.title FROM trip_events e JOIN trips t ON t.id = e.trip_id
            WHERE e.status = 'not_booked' AND t.done = 0 AND t.end_date >= ? AND e.date BETWEEN t.start_date AND t.end_date
            ORDER BY t.start_date, e.date, e.start_hour`,
      args: [today],
    }),
    db.execute({
      sql: `SELECT d.trip_id, t.name AS trip_name, d.date, d.accommodation, d.accommodation_status, d.cancel_by, d.non_refundable,
                   d.car, d.car_status, d.car_cancel_by, d.car_non_refundable
            FROM trip_days d JOIN trips t ON t.id = d.trip_id
            WHERE (d.accommodation != '' OR d.car != '') AND t.done = 0 AND t.end_date >= ? AND d.date BETWEEN t.start_date AND t.end_date
            ORDER BY t.start_date, d.trip_id, d.date`,
      args: [today],
    }),
    tripStarts(),
    listTodos(),
  ]);

  const byTrip = new Map<number, Planning["toBook"][number]>();
  const group = (trip_id: number, trip_name: string) => {
    if (!byTrip.has(trip_id)) byTrip.set(trip_id, { trip_id, trip_name, items: [] });
    return byTrip.get(trip_id)!;
  };
  for (const r of events.rows) {
    group(num(r.trip_id), str(r.trip_name)).items.push({ kind: "event", label: str(r.title), date: str(r.date), end_date: str(r.date) });
  }

  // Consecutive days with the same stay (or the same rental car) are one booking.
  type Night = {
    kind: "stay" | "car";
    trip_id: number;
    trip_name: string;
    date: string;
    place: string;
    confirmed: boolean;
    cancel_by: string;
    non_refundable: boolean;
  };
  const nights: Night[] = [];
  for (const kind of ["stay", "car"] as const) {
    const car = kind === "car";
    for (const r of stays.rows) {
      const place = str(car ? r.car : r.accommodation);
      if (!place) continue;
      nights.push({
        kind,
        trip_id: num(r.trip_id),
        trip_name: str(r.trip_name),
        date: str(r.date),
        place,
        confirmed: /confirm/i.test(str(car ? r.car_status : r.accommodation_status)),
        cancel_by: str(car ? r.car_cancel_by : r.cancel_by),
        non_refundable: num(car ? r.car_non_refundable : r.non_refundable) === 1,
      });
    }
  }
  const blocks: (Night & { to: string; nights: Night[] })[] = [];
  for (const n of nights) {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === n.kind && last.trip_id === n.trip_id && last.place === n.place && addDay(last.to) === n.date) {
      last.to = n.date;
      last.nights.push(n);
    } else {
      blocks.push({ ...n, to: n.date, nights: [n] });
    }
  }
  const deadlines: Planning["deadlines"] = [];
  for (const b of blocks) {
    if (b.nights.some((n) => !n.confirmed)) {
      group(b.trip_id, b.trip_name).items.push({ kind: b.kind, label: b.place, date: b.date, end_date: b.to });
    }
    for (const cancel_by of new Set(b.nights.filter((n) => n.cancel_by && !n.non_refundable).map((n) => n.cancel_by))) {
      if (cancel_by >= today) {
        deadlines.push({ trip_id: b.trip_id, trip_name: b.trip_name, kind: b.kind, accommodation: b.place, cancel_by, from: b.date, to: b.to });
      }
    }
  }
  for (const g of byTrip.values()) g.items.sort((a, b) => a.date.localeCompare(b.date));
  deadlines.sort((a, b) => a.cancel_by.localeCompare(b.cancel_by));

  return {
    toBook: [...byTrip.values()],
    deadlines,
    starts,
    todos: todos.filter((t) => !t.done),
  };
}
