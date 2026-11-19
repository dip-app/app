// App Store Connect API helper used by scripts/testflight-distribute.sh. No dependencies (Node crypto signs the ES256 JWT).
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const version = values("--version")[0];
const wantedGroups = values("--group");
const listOnly = flag("--list");
const dryRun = flag("--dry-run");
if (!version) { console.error("Usage: testflight-distribute.sh --version X.Y.Z [--group NAME]... [--list] [--dry-run]"); process.exit(2); }

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_FILE, BUNDLE_ID } = process.env;
const b64 = (b) => Buffer.from(b).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }));
  const body = b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1000, aud: "appstoreconnect-v1" }));
  const key = createPrivateKey(readFileSync(ASC_KEY_FILE));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64(sig)}`;
}
const jwt = token();
async function api(path, init = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...init, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = (json.errors ?? []).map((e) => `${e.status} ${e.code}: ${e.detail ?? e.title}`).join("; ");
    const err = new Error(`${init.method ?? "GET"} ${path.split("?")[0]} failed: ${detail || res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const apps = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data?.[0];
if (!app) { console.error(`No app with bundle id ${BUNDLE_ID}.`); process.exit(1); }
console.log(`app: ${app.attributes.name} (${BUNDLE_ID})`);

const builds = await api(`/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&sort=-uploadedDate&limit=10`);
const rows = builds.data ?? [];
for (const b of rows) console.log(`build ${b.attributes.version}: ${b.attributes.processingState}, uploaded ${b.attributes.uploadedDate}, expired=${b.attributes.expired}`);
const build = rows.find((b) => b.attributes.processingState === "VALID" && !b.attributes.expired);
if (!build) { console.error(`No processed (VALID) build for version ${version} yet. Processing takes 10-30 minutes after upload; try again later.`); process.exit(listOnly ? 0 : 1); }

const groups = (await api(`/v1/apps/${app.id}/betaGroups?limit=50`)).data ?? [];
for (const g of groups) console.log(`group "${g.attributes.name}": ${g.attributes.isInternalGroup ? "internal" : "external"}, all-builds=${g.attributes.hasAccessToAllBuilds}`);
if (listOnly) process.exit(0);

const targets = wantedGroups.length ? groups.filter((g) => wantedGroups.includes(g.attributes.name)) : groups;
if (!targets.length) { console.error("No matching beta groups."); process.exit(1); }
for (const g of targets) {
  const name = g.attributes.name;
  if (g.attributes.isInternalGroup && g.attributes.hasAccessToAllBuilds) { console.log(`"${name}": internal group with automatic access to all builds, nothing to add.`); continue; }
  const existing = (await api(`/v1/betaGroups/${g.id}/builds?limit=50`)).data ?? [];
  if (existing.some((b) => b.id === build.id)) { console.log(`"${name}": already has build ${build.attributes.version}.`); continue; }
  if (dryRun) { console.log(`"${name}": would add build ${build.attributes.version}.`); continue; }
  try {
    await api(`/v1/betaGroups/${g.id}/relationships/builds`, { method: "POST", body: JSON.stringify({ data: [{ type: "builds", id: build.id }] }) });
    console.log(`"${name}": added build ${build.attributes.version}.`);
  } catch (e) { console.error(`"${name}": ${e.message}`); }
}
