#!/usr/bin/env python3
"""Reads the "Llama + Shrimp Travels" workbook into .data/travel-import.json.

  python3 -I scripts/extract-xlsx.py "/path/to/Llama + Shrimp Travels.xlsx"

Budget tabs: contributions, which months are unlocked, every expense.
Trip tabs: one trip per tab (name = tab name, "✅ " means done), with every
itinerary cell as an event spanning the hours its merged range covers, its
colour mapped to the booking legend, the per-day rows under the grid, and
the tables further down as bookings (Item / Price / ...) or ideas.
"""
import json
import re
import sys
from datetime import date, datetime, time

import openpyxl
from openpyxl.utils import get_column_letter

path = sys.argv[1]
values = openpyxl.load_workbook(path, data_only=True)   # cached formula results
styled = openpyxl.load_workbook(path, data_only=False)  # fills + merges

LEGEND = {"FFD9D2E9": "unnecessary", "FFFCE5CD": "not_booked", "FFD9EAD3": "booked", "FFC9DAF8": "transit"}
LEGEND_WORDS = {"Booking Unecessary", "Booking Unnecessary", "Not Booked", "Booked", "Transit"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
# The sheet's months have no year; the cycle runs Sep 2026 → Jun 2027.
CYCLE_START_YEAR = 2026


def month_key(name):
    i = MONTHS.index(name) + 1
    return f"{CYCLE_START_YEAR if i >= 9 else CYCLE_START_YEAR + 1}-{i:02d}"


def fill_rgb(cell):
    f = cell.fill
    if f is None or f.fill_type is None:
        return None
    c = f.fgColor
    return c.rgb if c.type == "rgb" and c.rgb not in ("00000000",) else None


def text(v):
    if v is None:
        return ""
    if isinstance(v, datetime) and v.hour == v.minute == 0:
        return f"{v.month}/{v.day}"  # a typed "2/3" that the sheet turned into a date
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    return str(v).strip()


def number(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ---------------- budget ----------------
b = values["BUDGET"]
people = [
    {"slug": "ilana", "name": "Ilana", "contribution": float(b["I4"].value), "sort": 1},
    {"slug": "jason", "name": "Jason", "contribution": float(b["I8"].value), "sort": 0},
]
estimates = [{"category": text(b[f"A{r}"].value), "cost": float(b[f"B{r}"].value), "whom": text(b[f"C{r}"].value)}
             for r in range(4, 7) if b[f"A{r}"].value]
unlocks = []
for r in range(11, 31):
    month = b[f"A{r}"].value or b[f"A{r-1}"].value
    person = str(b[f"B{r}"].value).lower()
    unlocks.append({"person": person, "month": month_key(month), "unlocked": bool(b[f"E{r}"].value)})

expenses = []
for slug, sheet in (("ilana", "Ilana Expenditures"), ("jason", "Jason Expenditures")):
    ws = values[sheet]
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        m, cat, ident, amt, notes = [c.value for c in row[:5]]
        if not m or number(amt) is None:
            continue
        expenses.append({
            "person": slug,
            "month": month_key(str(m).strip()),
            "category": text(cat) or "Other",
            "kind": "visiting" if text(ident).lower().startswith("visit") else "travel",
            "amount": round(float(amt), 2),
            "notes": text(notes),
        })

# ---------------- trips ----------------
URL = re.compile(r"https?://\S+")
trips = []
for name in values.sheetnames[3:]:
    ws = values[name]
    st = styled[name]
    done = name.startswith("✅")
    trip = {"name": name.replace("✅", "").strip(), "done": done, "events": [], "days": {},
            "bookings": [], "ideas": []}

    # Day columns: header cells in row 1 that hold a date.
    day_cols = {}
    for c in range(2, ws.max_column + 1):
        v = ws.cell(1, c).value
        if isinstance(v, datetime):
            day_cols[c] = v.date().isoformat()
    if day_cols:
        trip["start_date"] = min(day_cols.values())
        trip["end_date"] = max(day_cols.values())
    else:
        # A link list with no grid: dates come from the first chkin/chkout in a URL.
        found = re.search(r"chkin=(\d{4}-\d{2}-\d{2}).*?chkout=(\d{4}-\d{2}-\d{2})",
                          " ".join(text(c.value) for row in ws.iter_rows() for c in row))
        trip["start_date"], trip["end_date"] = (found.group(1), found.group(2)) if found else ("2026-10-30", "2026-10-31")

    merged = {}
    for rng in st.merged_cells.ranges:
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                merged[(r, c)] = rng

    grid_rows = range(2, 24)  # row 2 = 3 AM … row 23 = midnight
    hour_of = lambda r: r + 1
    seen_ranges = set()
    side = {}  # (row, col) -> value for cells beside the grid
    for r in grid_rows if day_cols else []:
        for c in range(2, ws.max_column + 1):
            v = ws.cell(r, c).value
            if v is None or text(v) in LEGEND_WORDS:
                continue
            rng = merged.get((r, c))
            if rng and (rng.min_row, rng.min_col) != (r, c):
                continue  # not the anchor cell of its merged range
            if rng:
                if rng.coord in seen_ranges:
                    continue
                seen_ranges.add(rng.coord)
                r0, r1 = rng.min_row, min(rng.max_row, 23)
                c0, c1 = rng.min_col, rng.max_col
            else:
                r0 = r1 = r
                c0 = c1 = c
            status = LEGEND.get(fill_rgb(st.cell(r, c)) or "", "none")
            cols = [cc for cc in range(c0, c1 + 1) if cc in day_cols]
            if cols:
                for cc in cols:
                    trip["events"].append({"date": day_cols[cc], "start_hour": hour_of(r0),
                                           "end_hour": hour_of(r1) + 1, "title": text(v), "status": status})
            else:
                side[(r, c)] = v

    def idea(group, parts, price=None):
        """One idea from a row's cells: URLs become the link, $20+ numbers the price."""
        link = ""
        out = []
        for v in parts:
            t = text(v)
            m = URL.search(t)
            if m and not link:
                link = m.group(0)
                t = t.replace(link, "").strip()
            if number(v) is not None:
                if price is None and number(v) >= 20:
                    price = number(v)
                    continue
                t = f"{number(v):g}"
            if t:
                out.append(t)
        trip["ideas"].append({"group": group, "text": " · ".join(out) or ("link" if link else ""),
                              "link": link, "price": price})

    if day_cols:
        # Side lists beside the grid, read column by column. An ALL-CAPS cell
        # starts a group; a column with no header of its own is a value column
        # for the list on its left (e.g. Groceries | $150-200 total).
        side_cols = sorted({c for _, c in side} | {c for c in range(2, ws.max_column + 1)
                                                   if c not in day_cols and text(ws.cell(1, c).value)})
        is_header = lambda v: isinstance(v, str) and v.strip().isupper() and len(v) < 40
        own_header = {c: any(is_header(ws.cell(r, c).value) for r in range(1, 24)) for c in side_cols}
        for c in side_cols:
            if c - 1 in side_cols and not own_header[c]:
                continue  # read alongside the column to its left
            # A column without its own title shares the nearest one to its left (todo → llama | shrimp).
            group = next((text(ws.cell(1, cc).value) for cc in range(c, 1, -1)
                          if cc in side_cols and text(ws.cell(1, cc).value)), "")
            for r in grid_rows:
                v = side.get((r, c))
                if v is None:
                    continue
                if is_header(v):
                    group = text(v)
                    continue
                extra = side.get((r, c + 1)) if (c + 1 in side_cols and not own_header.get(c + 1, True)) else None
                idea(group, [v] + ([extra] if extra is not None else []))
    else:
        # No calendar grid (a page of links): every row is one idea, grouped
        # under the last label seen in column A.
        group = ""
        for r in range(1, ws.max_row + 1):
            row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
            cells = [v for v in row if v is not None and text(v)]
            if not cells:
                continue
            if row[0] is not None and not URL.search(text(row[0])):
                group = text(row[0])
                cells = cells[1:]
            if cells:
                idea(group, cells)

    # Rows under the grid: per-day rows by label, otherwise blocks of tables.
    def day_row(r, key):
        for c, d in day_cols.items():
            v = ws.cell(r, c).value
            if v is not None and text(v):
                trip["days"].setdefault(d, {})
                prev = trip["days"][d].get(key, "")
                trip["days"][d][key] = (prev + " · " if prev and key == "notes" else "") + text(v)

    block = None
    blanks = 0
    for r in range(24, ws.max_row + 1) if day_cols else []:
        row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        if all(v is None for v in row):
            # One blank row is spacing inside a table; two end it.
            blanks += 1
            if blanks >= 2:
                block = None
            continue
        blanks = 0
        label = text(row[0]).lower()
        if label.startswith("accom"):
            day_row(r, "accommodation"); continue
        if label == "status":
            day_row(r, "accommodation_status"); continue
        if label in ("notes", "lunch", "dinner", "car") or label.startswith("map"):
            if label.startswith("map"):
                continue
            for c, d in day_cols.items():
                v = ws.cell(r, c).value
                if v is not None and text(v):
                    trip["days"].setdefault(d, {})
                    prefix = "" if label == "notes" else f"{label.title()}: "
                    prev = trip["days"][d].get("notes", "")
                    trip["days"][d]["notes"] = (prev + " · " if prev else "") + prefix + text(v)
            continue
        cells = [(c, v) for c, v in enumerate(row) if v is not None and text(v)]
        if block is None:
            # A table's first row is its header: it names the group.
            header = " ".join(text(v) for _, v in cells)
            block = {"kind": "bookings" if "price" in header.lower() and "item" in header.lower() else "ideas",
                     "group": text(cells[0][1])[:40]}
            if block["kind"] == "bookings" or len(text(cells[0][1])) < 40:
                continue
        # Column sub-headers ("Departs · Arrives") have nothing in column A.
        if row[0] is None and all(number(v) is None and len(text(v)) < 15 for _, v in cells):
            continue
        if block["kind"] == "bookings":
            item, price, canc, notes = (text(row[0]), number(row[1]), text(row[2]) if len(row) > 2 else "",
                                        text(row[3]) if len(row) > 3 else "")
            if item:
                trip["bookings"].append({"item": item, "price": price, "cancellation": canc, "notes": notes})
        else:
            # Numbers of $20+ read as prices; small ones (like a 1–3 ranking) stay as text.
            price = next((number(v) for _, v in cells if (number(v) or 0) >= 20), None)
            fmt = lambda v: (f"{v:g}" if number(v) is not None else text(v))
            joined = " · ".join(fmt(v) for _, v in cells if v is not price)
            link = URL.search(joined)
            if link:
                joined = joined.replace(link.group(0), "").strip(" ·") or "link"
            trip["ideas"].append({"group": block["group"], "text": joined[:500], "link": link.group(0) if link else "",
                                  "price": price})
    trips.append(trip)

out = {"cycle": {"start_month": f"{CYCLE_START_YEAR}-09", "end_month": f"{CYCLE_START_YEAR + 1}-06"},
       "people": people, "estimates": estimates, "unlocks": unlocks, "expenses": expenses, "trips": trips}
with open(".data/travel-import.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
print(f"{len(people)} people, {sum(u['unlocked'] for u in unlocks)} unlocked person-months, "
      f"{len(expenses)} expenses, {len(trips)} trips "
      f"({sum(len(t['events']) for t in trips)} events, {sum(len(t['bookings']) for t in trips)} bookings, "
      f"{sum(len(t['ideas']) for t in trips)} ideas)")
