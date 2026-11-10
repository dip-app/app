#!/usr/bin/env node
// Idempotent seed of the "Fitness" weekly theme (a Challenge, contracts/v1) for one or more companies.
// See docs/contracts/callables.md "Weekly themes". DRY-RUN BY DEFAULT: nothing is written unless --apply.
//
//   node scripts/seed-weekly-theme.mjs --project <PROJECT_ID> --company <ID> [--company <ID> ...]
//        [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--weeks N] [--apply]
//
// --start  first local day (America/New_York) of the window, 00:00. Default: Monday of the current NY week.
// --end    last local day (inclusive), window ends 23:59:59 NY. Default: start + 6 days (a Monday..Sunday week).
// --weeks  create N consecutive windows, each shifted by 7 days (default 1).
//
// Document ID is deterministic: companies/{c}/challenges/weekly-fitness-<yyyymmdd of the NY start day>, so a
// rerun never duplicates. An existing document is never overwritten; a window that overlaps another weekly
// theme in the company is refused (the server enforces the same rule as CHALLENGE_WINDOW_OVERLAP).
// tagIds is the ID of the tag named "Fitness" in tags/ (aborts if it is missing or ambiguous).
// Credentials: Application Default Credentials (gcloud auth application-default login), or
// FIRESTORE_EMULATOR_HOST for a local emulator. Never commit credentials.
import { createRequire } from "node:module";

const ZONE = "America/New_York";
const DAY_MS = 86_400_000;
const MAX_SPAN_MS = 14 * DAY_MS;
export const THEME = Object.freeze({
  title: "Fitness",
  description: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
  type: "weekly",
  goal: 3,
  goalUnit: "workouts",
  pointsReward: 50,
  coverImageURL: "catalog://theme/fitness",
  tagName: "Fitness",
});

/** Offset (ms) of New York wall time from UTC at instant `ms` (e.g. -5 h in winter). */
function zoneOffset(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of 00:00 New York time on the given local calendar day. */
export function nyMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - zoneOffset(guess);
  instant = guess - zoneOffset(instant); // settle across a DST boundary
  return instant;
}

/** New York calendar day (y, m, d, weekday 0=Sun) of instant `ms`. */
function nyDay(ms) {
  const wall = new Date(ms + zoneOffset(ms));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate(), weekday: wall.getUTCDay() };
}

function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day) + n * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseDay(value, name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) throw new Error(`${name} must be YYYY-MM-DD`);
  const day = { year: +match[1], month: +match[2], day: +match[3] };
  const check = addDays(day, 0);
  if (check.year !== day.year || check.month !== day.month || check.day !== day.day) throw new Error(`${name} is not a calendar date`);
  return day;
}

const ymd = ({ year, month, day }) => `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");

/**
 * Plans the windows: [{ id, startMs, endMs }]. Pure (testable); `nowMs` picks the default current week.
 */
export function planWindows({ start, end, weeks = 1, nowMs = Date.now() }) {
  let first;
  if (start) first = parseDay(start, "--start");
  else { const today = nyDay(nowMs); first = addDays(today, -((today.weekday + 6) % 7)); }
  const last = end ? parseDay(end, "--end") : addDays(first, 6);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new Error("--weeks must be an integer 1..52");
  const windows = [];
  for (let w = 0; w < weeks; w += 1) {
    const s = addDays(first, 7 * w);
    const e = addDays(last, 7 * w);
    const startMs = nyMidnight(s.year, s.month, s.day);
    const endMs = nyMidnight(...Object.values(addDays(e, 1))) - 1000;
    if (endMs <= startMs) throw new Error("--end must be on or after --start");
    if (endMs - startMs > MAX_SPAN_MS) throw new Error("a window may span at most 14 days");
    windows.push({ id: `weekly-fitness-${ymd(s)}`, startMs, endMs });
  }
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i].startMs <= windows[i - 1].endMs) throw new Error("windows overlap each other; use a span of at most 7 days with --weeks");
  }
  return windows;
}

function parseArgs(argv) {
  const out = { companies: [], apply: false, weeks: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => { const v = argv[++i]; if (!v || v.startsWith("--")) throw new Error(`${arg} needs a value`); return v; };
    if (arg === "--apply") out.apply = true;
    else if (arg === "--project") out.project = value();
    else if (arg === "--company") out.companies.push(value());
    else if (arg === "--start") out.start = value();
    else if (arg === "--end") out.end = value();
    else if (arg === "--weeks") out.weeks = Number(value());
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!out.project) throw new Error("--project is required");
  if (out.companies.length === 0) throw new Error("at least one --company is required");
  for (const c of out.companies) if (!/^[A-Za-z0-9_-]{1,128}$/.test(c)) throw new Error(`invalid company id ${c}`);
  return out;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(`${error.message}\nUsage: seed-weekly-theme.mjs --project <PROJECT_ID> --company <ID> [--company <ID>] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--weeks N] [--apply]`);
    process.exit(2);
  }
  let windows;
  try { windows = planWindows(args); } catch (error) { console.error(error.message); process.exit(2); }

  const requireFromFunctions = createRequire(new URL("../gcp/functions/package.json", import.meta.url));
  const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore, Timestamp } = requireFromFunctions("firebase-admin/firestore");
  const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : `LIVE project ${args.project}`;
  console.log(`${args.apply ? "APPLY" : "DRY-RUN"} against ${target}`);
  const app = initializeApp({ projectId: args.project }, "seed-weekly-theme");
  const db = getFirestore(app);
  try {
    const tags = await db.collection("tags").where("name", "==", THEME.tagName).get();
    if (tags.size !== 1) {
      console.error(tags.empty
        ? `ABORT: no tag named "${THEME.tagName}" in tags/. Create it with the trusted tag tooling first; nothing written.`
        : `ABORT: ${tags.size} tags are named "${THEME.tagName}" (${tags.docs.map((d) => d.id).join(", ")}); resolve the duplicate first; nothing written.`);
      process.exitCode = 1;
      return;
    }
    const tagId = tags.docs[0].id;
    console.log(`tag "${THEME.tagName}" -> ${tagId}`);

    let planned = 0;
    let blocked = 0;
    const writes = [];
    for (const companyId of args.companies) {
      const company = await db.collection("companies").doc(companyId).get();
      if (!company.exists) { console.log(`BLOCKED   ${companyId}: company document missing`); blocked += 1; continue; }
      const challenges = db.collection("companies").doc(companyId).collection("challenges");
      for (const w of windows) {
        const label = `${companyId}/${w.id}  ${iso(w.startMs)} .. ${iso(w.endMs)}`;
        const existing = await challenges.doc(w.id).get();
        if (existing.exists) {
          const s0 = existing.get("startDate"), e0 = existing.get("endDate");
          const same = s0 instanceof Timestamp && e0 instanceof Timestamp && s0.toMillis() === w.startMs && e0.toMillis() === w.endMs;
          if (same) { console.log(`exists    ${label}  (left unchanged)`); continue; }
          console.log(`BLOCKED   ${label}  (document exists with another window; never overwritten)`);
          blocked += 1;
          continue;
        }
        const nearby = await challenges
          .where("endDate", ">=", Timestamp.fromMillis(w.startMs))
          .where("endDate", "<=", Timestamp.fromMillis(w.endMs + MAX_SPAN_MS)).get();
        const conflict = nearby.docs.find((d) => d.get("type") === "weekly"
          && d.get("startDate") instanceof Timestamp && d.get("startDate").toMillis() <= w.endMs);
        if (conflict) {
          console.log(`BLOCKED   ${label}  (overlaps ${conflict.id} ${iso(conflict.get("startDate").toMillis())} .. ${iso(conflict.get("endDate").toMillis())})`);
          blocked += 1;
          continue;
        }
        console.log(`create    ${label}  "${THEME.title}" goal ${THEME.goal} ${THEME.goalUnit}, +${THEME.pointsReward} pts, ${THEME.coverImageURL}`);
        planned += 1;
        writes.push({ ref: challenges.doc(w.id), companyId, w });
      }
    }
    console.log(`${planned} to create, ${blocked} blocked, ${args.companies.length} company(ies), ${windows.length} window(s) each.`);
    if (blocked) process.exitCode = 1;
    if (!args.apply) { console.log("Dry run: nothing written. Re-run with --apply to create the documents above."); return; }
    const now = Timestamp.fromMillis(Math.floor(Date.now() / 1000) * 1000);
    let created = 0;
    for (const { ref, companyId, w } of writes) {
      try {
        // create() fails if the document appeared meanwhile, so a concurrent rerun never overwrites.
        await ref.create({
          companyId,
          title: THEME.title,
          description: THEME.description,
          tagIds: [tagId],
          type: THEME.type,
          goal: THEME.goal,
          goalUnit: THEME.goalUnit,
          coverImageURL: THEME.coverImageURL,
          startDate: Timestamp.fromMillis(w.startMs),
          endDate: Timestamp.fromMillis(w.endMs),
          pointsReward: THEME.pointsReward,
          participantCount: 0,
          completedCount: 0,
          createdAt: now,
          updatedAt: now,
          revision: 1,
        });
        created += 1;
      } catch (error) {
        console.error(`not created ${ref.path}: ${error.code === 6 ? "already exists" : error.message}`);
        process.exitCode = 1;
      }
    }
    console.log(`Created ${created} challenge document(s).`);
  } finally {
    await deleteApp(app);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
