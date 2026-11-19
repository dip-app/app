// Participant browser driver for the admin usability study.
// One server per participant: its own headless Chrome, its own browser context (so the mock's localStorage is private),
// a command log with timestamps, and screenshots in a scratch directory. Participants talk to it through drive.mjs.
//
// node server.mjs --port 4401 --base http://localhost:3317/admin --out /scratch/p1 [--locale es-MX] [--width 1440 --height 900]
// Needs playwright-core (installed outside the repo) and Google Chrome (channel "chrome").
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const require = createRequire(process.env.PW_CORE_DIR ? path.join(process.env.PW_CORE_DIR, "x.js") : import.meta.url);
const { chromium } = require("playwright-core");

const port = Number(args.port || 4401);
const base = (args.base || "http://localhost:3317/admin").replace(/\/$/, "");
const out = args.out || "./out";
const locale = args.locale || "en-US";
let width = Number(args.width || 1440);
let height = Number(args.height || 900);
fs.mkdirSync(path.join(out, "shots"), { recursive: true });
const logFile = path.join(out, "commands.jsonl");
let shotN = 0;

const browser = await chromium.launch({ channel: "chrome", headless: true });
let context;
let page;
const isPhone = () => width < 768;
async function newContext() {
  if (context) await context.close();
  context = await browser.newContext({
    viewport: { width, height }, locale, timezoneId: "America/New_York", reducedMotion: "reduce",
    hasTouch: isPhone(), isMobile: isPhone(), deviceScaleFactor: 1,
  });
  page = await context.newPage();
  // A "Leave site?" prompt only appears when the moderator's `goto` leaves a dirty form: accept it (the moderator resets
  // the screen between tasks). Other browser dialogs are reported to the participant and dismissed.
  page.on("dialog", (d) => { lastDialog = `${d.type()}: ${d.message()}`; void (d.type() === "beforeunload" ? d.accept() : d.dismiss()); });
}
let lastDialog = "";
await newContext();
await page.goto(`${base}/login/`, { waitUntil: "networkidle" });

// Numbered list of interactive elements that are visible in the viewport, by role and accessible name (no source ids).
async function listElements(all = false) {
  return page.evaluate((all) => {
    document.querySelectorAll("[data-drv]").forEach((e) => e.removeAttribute("data-drv"));
    const sel = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"], [role="combobox"], [role="textbox"], [tabindex]:not([tabindex="-1"]), label:has(input[type=file])';
    const vh = window.innerHeight, vw = window.innerWidth;
    const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
    const name = (el) => {
      if (el.getAttribute("aria-labelledby")) return txt(el.getAttribute("aria-labelledby").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" "));
      if (el.getAttribute("aria-label")) return txt(el.getAttribute("aria-label"));
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return txt(l.innerText); }
      const wrap = el.closest("label"); if (wrap && wrap !== el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return txt(wrap.innerText);
      if (["INPUT", "TEXTAREA"].includes(el.tagName)) return txt(el.placeholder || el.title || "");
      return txt(el.innerText || el.title || el.querySelector("img")?.alt || "");
    };
    const role = (el) => el.getAttribute("role") || ({ A: "link", BUTTON: "button", SELECT: "select", TEXTAREA: "textbox", SUMMARY: "disclosure", LABEL: "file-picker" }[el.tagName]) ||
      (el.tagName === "INPUT" ? ({ checkbox: "checkbox", radio: "radio", file: "file-picker", search: "searchbox", submit: "button", button: "button", range: "slider" }[el.type] || `textbox(${el.type})`) : el.tagName.toLowerCase());
    const rows = [];
    let below = 0, above = 0, n = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      const hiddenInput = el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox") && (r.width < 2 || st.opacity === "0");
      if (!hiddenInput && (r.width < 1 || r.height < 1 || st.visibility === "hidden" || st.display === "none")) continue;
      if (el.closest("[inert], [aria-hidden=true]")) continue;
      const box = hiddenInput ? (el.closest("label") || el.parentElement).getBoundingClientRect() : r;
      if (!all) { if (box.bottom < 0) { above++; continue; } if (box.top > vh) { below++; continue; } if (box.right < 0 || box.left > vw) continue; }
      n++;
      el.setAttribute("data-drv", String(n));
      const states = [];
      if (el.disabled || el.getAttribute("aria-disabled") === "true") states.push("disabled");
      if (el.checked || el.getAttribute("aria-checked") === "true") states.push("checked");
      if (el.getAttribute("aria-pressed") === "true") states.push("pressed");
      if (el.getAttribute("aria-selected") === "true") states.push("selected");
      if (el.getAttribute("aria-current")) states.push("current");
      if (el.getAttribute("aria-expanded")) states.push(el.getAttribute("aria-expanded") === "true" ? "expanded" : "collapsed");
      if (el.required || el.getAttribute("aria-required") === "true") states.push("required");
      if (el.getAttribute("aria-invalid") === "true") states.push("invalid");
      let value = "";
      if (el.tagName === "SELECT") value = ` value="${txt(el.options[el.selectedIndex]?.text)}" options=[${[...el.options].map((o) => txt(o.text)).slice(0, 12).join(" | ")}${el.options.length > 12 ? " | ..." : ""}]`;
      else if (["INPUT", "TEXTAREA"].includes(el.tagName) && !["checkbox", "radio", "file", "button", "submit"].includes(el.type)) value = ` value="${txt(el.value).slice(0, 80)}"`;
      if (el === document.activeElement) states.push("focused");
      rows.push(`[${n}] ${role(el)} "${name(el).slice(0, 90)}"${value}${states.length ? " (" + states.join(", ") + ")" : ""}`);
    }
    return { rows, above, below, scrollY: Math.round(window.scrollY || document.querySelector("main")?.scrollTop || 0) };
  }, all);
}

async function el(target) {
  if (/^\d+$/.test(String(target))) {
    const loc = page.locator(`[data-drv="${target}"]`);
    if (await loc.count() === 0) throw new Error(`No element number ${target} on screen. Run "list" again.`);
    return loc.first();
  }
  const field = page.getByLabel(String(target), { exact: true }).or(page.getByPlaceholder(String(target), { exact: true })).filter({ visible: true });
  if (await field.count() > 0) return field.first();
  const exact = page.getByText(String(target), { exact: true }).filter({ visible: true });
  if (await exact.count() > 0) return exact.first();
  const role = page.getByRole("button", { name: String(target) }).or(page.getByRole("link", { name: String(target) })).filter({ visible: true });
  if (await role.count() > 0) return role.first();
  const loose = page.getByText(String(target)).filter({ visible: true });
  if (await loose.count() > 0) return loose.first();
  throw new Error(`Nothing visible with text "${target}".`);
}

async function settle() { await page.waitForTimeout(500); await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(300); }
async function where() { const u = new URL(page.url()); return `Page: ${await page.title()} | address: ${u.pathname.replace(/^\/admin/, "")}${u.search}`; }
async function focused() {
  return page.evaluate(() => {
    const el = document.activeElement; if (!el || el === document.body) return "Focus: (page body, nothing focused)";
    const n = el.getAttribute("aria-label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.innerText || el.placeholder || el.value || "";
    return `Focus: ${el.getAttribute("role") || el.tagName.toLowerCase()}${el.type ? "(" + el.type + ")" : ""} "${n.replace(/\s+/g, " ").trim().slice(0, 100)}"`;
  });
}

const commands = {
  async shot(name) {
    shotN++;
    const file = path.join(out, "shots", `${String(shotN).padStart(3, "0")}${name ? "-" + name.replace(/[^a-z0-9-]/gi, "_") : ""}.png`);
    await page.screenshot({ path: file });
    return `${await where()}\nScreenshot saved: ${file}`;
  },
  async list(all) { const r = await listElements(all === "all"); return `${await where()}\n${r.above ? `(${r.above} more interactive elements above, scroll up)\n` : ""}${r.rows.join("\n") || "(no interactive elements visible)"}${r.below ? `\n(${r.below} more interactive elements below, scroll down)` : ""}`; },
  async read() {
    const text = await page.evaluate(() => {
      const vh = window.innerHeight; const lines = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node; let lastEl = null; let buf = "";
      while ((node = walker.nextNode())) {
        const p = node.parentElement; if (!p || p.closest("script,style,[aria-hidden=true],[hidden]")) continue;
        const t = node.textContent.replace(/\s+/g, " ").trim(); if (!t) continue;
        const r = p.getBoundingClientRect(); const st = getComputedStyle(p);
        if (r.width < 1 || r.bottom < 0 || r.top > vh || st.visibility === "hidden" || st.opacity === "0") continue;
        if (p.closest("svg") || (st.position === "absolute" && st.clip !== "auto" && r.width <= 1)) continue;
        const block = p.closest("p,li,h1,h2,h3,h4,td,th,button,a,label,dt,dd,div,span") ;
        if (block !== lastEl && buf) { lines.push(buf); buf = ""; }
        lastEl = block; buf += (buf ? " " : "") + t;
      }
      if (buf) lines.push(buf);
      return lines.join("\n");
    });
    return `${await where()}\n${text.slice(0, 6000)}`;
  },
  async tree() { const snap = await page.locator("body").ariaSnapshot(); return `${await where()}\n${snap.slice(0, 9000)}`; },
  async click(target) { const e = await el(target); await e.scrollIntoViewIfNeeded().catch(() => {}); await e.click({ timeout: 4000 }); await settle(); return `Clicked. ${await where()}${lastDialog ? "\nBrowser dialog: " + lastDialog : ""}`; },
  async type(target, ...text) {
    const value = text.join(" ");
    const e = await el(target); await e.click({ timeout: 4000 });
    // Replace what the focused field holds (clicking a label focuses its input; round 1 appended to it: "2030").
    await page.evaluate(() => { const f = document.activeElement; if (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement) f.select(); });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(value, { delay: 15 }); await settle();
    return `Typed "${value}". ${await focused()}`;
  },
  async keys(...text) { await page.keyboard.type(text.join(" "), { delay: 15 }); await settle(); return `Typed. ${await focused()}`; },
  async press(key, times = "1") { for (let i = 0; i < Number(times); i++) await page.keyboard.press(key); await settle(); return `${await focused()}\n${await where()}`; },
  async focus() { return `${await focused()}\n${await where()}`; },
  async select(target, ...option) { const e = await el(target); await e.selectOption({ label: option.join(" ") }).catch(async () => e.selectOption(option.join(" "))); await settle(); return `Selected "${option.join(" ")}".`; },
  async scroll(dir = "down", amount = "600") {
    const dy = (dir === "up" ? -1 : 1) * Number(amount);
    await page.mouse.move(width / 2, height / 2); await page.mouse.wheel(0, dy); await page.waitForTimeout(400);
    return `Scrolled ${dir}. ${await where()}`;
  },
  async back() { await page.goBack().catch(() => {}); await settle(); return `Went back. ${await where()}`; },
  async goto(p = "/") { if (/^https?:/.test(p)) throw new Error("Only addresses inside this app."); await page.goto(`${base}${p.startsWith("/") ? p : "/" + p}`); await settle(); return await where(); },
  async viewport(w, h) { width = Number(w); height = Number(h); await newContext(); await page.goto(`${base}/login/`); await settle(); return `New window ${width}x${height} (phone=${isPhone()}). You are signed out; the app state was reset. ${await where()}`; },
  async reset() { await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {}); await page.goto(`${base}/login/`); await settle(); return `App reset to its starting data and signed out. ${await where()}`; },
  async url() { return where(); },
};

const server = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const { cmd, args: a = [], note = "" } = JSON.parse(body || "{}");
  const t0 = Date.now();
  let result; let ok = true;
  try {
    if (cmd === "quit") { res.end("bye"); fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), cmd }) + "\n"); await browser.close(); server.close(); process.exit(0); }
    if (!commands[cmd]) throw new Error(`Unknown command "${cmd}". Commands: ${Object.keys(commands).join(", ")}`);
    lastDialog = "";
    result = await commands[cmd](...a);
  } catch (e) { ok = false; result = `ERROR: ${String(e.message || e).split("\n")[0]}`; }
  fs.appendFileSync(logFile, JSON.stringify({ t: new Date(t0).toISOString(), ms: Date.now() - t0, cmd, args: a, ok, url: page.url().replace(base, ""), note }) + "\n");
  res.end(result);
});
server.listen(port, "127.0.0.1", () => console.log(`driver on ${port}, base ${base}, out ${out}`));
