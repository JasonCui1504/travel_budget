import { NextRequest } from "next/server";
import { requireUser } from "./auth";
import { getTravelDb } from "./db";

type Field = {
  name: string;
  type: "string" | "number" | "bool" | "month" | "date" | "enum";
  required?: boolean;
  nullable?: boolean;
  values?: readonly string[];
};

type Ctx = { params: Promise<{ id: string }> };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function bad(msg: string) {
  return Response.json({ error: msg }, { status: 400 });
}

/**
 * An unexpected failure: logged (for the Vercel function logs) and sent back
 * with its reason, so the page shows why instead of a bare "Request failed (500)".
 */
export function failure(what: string, e: unknown): Response {
  console.error(`Travel: ${what} failed`, e);
  const reason = e instanceof Error ? e.message : String(e);
  return Response.json({ error: `Couldn't save: ${reason}` }, { status: 500 });
}

/** Turns a constraint failure (e.g. a person or trip that doesn't exist) into a 400, anything else into failure(). */
async function write(what: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && /SQLITE_CONSTRAINT/.test(e.message)) {
      return bad(/FOREIGN KEY/.test(e.message) ? "That person or trip doesn't exist" : "That value isn't allowed");
    }
    return failure(what, e);
  }
}

/** Validates and coerces one field; returns [value] or an error message. */
function coerce(f: Field, raw: unknown): [unknown] | string {
  if (raw == null || raw === "") {
    if (f.required) return `${f.name} is required`;
    return f.nullable ? [null] : [f.type === "number" ? 0 : f.type === "bool" ? 0 : ""];
  }
  switch (f.type) {
    case "string":
      return [String(raw).trim()];
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? [n] : `${f.name} must be a number`;
    }
    case "bool":
      return [raw === true || raw === 1 || raw === "1" || raw === "true" ? 1 : 0];
    case "month":
      return MONTH.test(String(raw)) ? [String(raw)] : `${f.name} must be YYYY-MM`;
    case "date":
      return DATE.test(String(raw)) ? [String(raw)] : `${f.name} must be YYYY-MM-DD`;
    case "enum":
      return f.values?.includes(String(raw)) ? [String(raw)] : `${f.name} must be one of ${f.values?.join(", ")}`;
  }
}

/**
 * Session-gated create/update/delete handlers for one table. Only the listed
 * fields can be written; everything else in the body is ignored.
 */
export function makeCrud(
  table: string,
  fields: Field[],
  /** Extra checks for a new row; returns an error message or null. */
  validateNew?: (body: Record<string, unknown>) => string | null
) {
  async function POST(request: NextRequest) {
    const auth = requireUser(request);
    if ("response" in auth) return auth.response;
    const body = await request.json();
    const invalid = validateNew?.(body);
    if (invalid) return bad(invalid);
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) {
      const r = coerce(f, body[f.name]);
      if (typeof r === "string") return bad(r);
      cols.push(f.name);
      vals.push(r[0]);
    }
    return write(`POST ${table}`, async () => {
      const db = await getTravelDb();
      const rs = await db.execute({
        sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING id`,
        args: vals as (string | number | null)[],
      });
      return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
    });
  }

  async function PUT(request: NextRequest, ctx: Ctx) {
    const auth = requireUser(request);
    if ("response" in auth) return auth.response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return bad("Invalid id");
    const body = await request.json();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of fields) {
      if (!(f.name in body)) continue;
      const r = coerce(f, body[f.name]);
      if (typeof r === "string") return bad(r);
      sets.push(`${f.name} = ?`);
      vals.push(r[0]);
    }
    if (sets.length === 0) return bad("Nothing to update");
    return write(`PUT ${table} ${id}`, async () => {
      const db = await getTravelDb();
      await db.execute({
        sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`,
        args: [...vals, id] as (string | number | null)[],
      });
      return Response.json({ ok: true });
    });
  }

  async function DELETE(request: NextRequest, ctx: Ctx) {
    const auth = requireUser(request);
    if ("response" in auth) return auth.response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return bad("Invalid id");
    return write(`DELETE ${table} ${id}`, async () => {
      const db = await getTravelDb();
      await db.execute({ sql: `DELETE FROM ${table} WHERE id = ?`, args: [id] });
      return Response.json({ ok: true });
    });
  }

  return { POST, PUT, DELETE };
}
