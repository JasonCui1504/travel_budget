// Sets (or adds) a travel app login, stored as an scrypt hash in the
// travel database. The password itself is never written anywhere.
//
//   node scripts/set-password.mjs jason                          # local database
//   node scripts/set-password.mjs jason --env .env.travel-prod   # the live (Turso) database
//
// Takes effect immediately — no redeploy or restart needed.
import { createClient } from "@libsql/client";
import { randomBytes, scryptSync } from "crypto";
import { existsSync, readFileSync } from "fs";

const user = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[a-z0-9_-]+$/.test(user)) {
  console.error("Usage: node scripts/set-password.mjs <username> [--env .env.travel-prod]");
  process.exit(1);
}
const envArg = process.argv.indexOf("--env");
const envFile = envArg > -1 ? process.argv[envArg + 1] : ".env.local";
const env = Object.fromEntries(
  (existsSync(envFile) ? readFileSync(envFile, "utf8") : "")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")])
);
if (envArg > -1 && !/^libsql:\/\//.test(env.TRAVEL_DATABASE_URL ?? "")) {
  console.error(`${envFile} needs TRAVEL_DATABASE_URL (libsql://…) and TRAVEL_DATABASE_AUTH_TOKEN.`);
  process.exit(1);
}
const url = env.TRAVEL_DATABASE_URL || "file:.data/travel.db";
const where = url.startsWith("file:") ? "the local database" : "the live database";

// Read the password twice without echoing it.
async function ask(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let pw = "";
  const answer = await new Promise((done) => {
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", onData);
          return done(pw);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") pw = pw.slice(0, -1);
        else pw += ch;
      }
    };
    process.stdin.on("data", onData);
  });
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\n");
  return answer;
}

const password = await ask(`New password for ${user} (${where}): `);
if (password.length < 8) {
  console.error("Use at least 8 characters.");
  process.exit(1);
}
if ((await ask("Type it again: ")) !== password) {
  console.error("Those didn't match — nothing was changed.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
const db = createClient({ url, authToken: env.TRAVEL_DATABASE_AUTH_TOKEN });
await db.execute(`CREATE TABLE IF NOT EXISTS travel_users (
  username TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
await db.execute({
  sql: `INSERT INTO travel_users (username, hash) VALUES (?, ?)
        ON CONFLICT(username) DO UPDATE SET hash = excluded.hash, updated_at = datetime('now')`,
  args: [user, hash],
});
console.log(`Saved ${user} in ${where}. It works right away.`);
