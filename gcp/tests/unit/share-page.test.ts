import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { getSharePage, type ShareEventStore } from "../../functions/src/modules/share/application/getSharePage";
import {
  APP_STORE_ID_PLACEHOLDER, SHARE_ORIGIN, buildPreview, coarseDate, escapeHtml, genericPreview, parseEventIdFromPath,
  renderSharePage, resolveImage, truncateAtWord, type ShareEvent,
} from "../../functions/src/modules/share/domain/sharePage";
import { handleSharePage, type ShareResponse } from "../../functions/src/modules/share/transport/eventSharePageV1";

const EVENT: ShareEvent = {
  title: "Sunset hike",
  description: "Bring water.\n\nWe meet at the   trailhead.",
  startTime: new Date("2026-11-20T22:30:00Z"),
  coverImageURL: "catalog://default/hiking",
  status: "scheduled",
};
const SECRETS = ["123 Secret Street", "Pittsburgh", "40.4406", "co-secret", "Alice Attendee", "6:30", "PM", "going"];

function metaContent(html: string, key: string): string | null {
  const m = new RegExp(`<meta (?:property|name)="${key.replace(/[:.]/g, "\\$&")}" content="([^"]*)">`).exec(html);
  return m ? m[1]! : null;
}

describe("share page domain", () => {
  test("renders every og, twitter and generic tag with absolute https URLs", () => {
    const html = renderSharePage(buildPreview("evt_123", EVENT));
    const image = `${SHARE_ORIGIN}/share/og/hiking.jpg`;
    assert.equal(metaContent(html, "og:title"), "Sunset hike");
    assert.equal(metaContent(html, "og:description"), "Fri, Nov 20 · Bring water. We meet at the trailhead.");
    assert.equal(metaContent(html, "og:url"), `${SHARE_ORIGIN}/e/evt_123`);
    assert.equal(metaContent(html, "og:site_name"), "DIP");
    assert.equal(metaContent(html, "og:type"), "website");
    assert.equal(metaContent(html, "og:locale"), "en_US");
    for (const key of ["og:image", "og:image:secure_url", "twitter:image"]) assert.equal(metaContent(html, key), image);
    assert.equal(metaContent(html, "og:image:width"), "1200");
    assert.equal(metaContent(html, "og:image:height"), "630");
    assert.equal(metaContent(html, "og:image:type"), "image/jpeg");
    assert.ok(metaContent(html, "og:image:alt"));
    assert.equal(metaContent(html, "twitter:card"), "summary_large_image");
    assert.equal(metaContent(html, "twitter:title"), "Sunset hike");
    assert.equal(metaContent(html, "twitter:description"), metaContent(html, "og:description"));
    assert.ok(metaContent(html, "twitter:image:alt"));
    assert.equal(metaContent(html, "description"), metaContent(html, "og:description"));
    assert.equal(metaContent(html, "theme-color"), "#7B88FA");
    assert.match(metaContent(html, "apple-itunes-app")!, new RegExp(`^app-id=${APP_STORE_ID_PLACEHOLDER}, app-argument=${SHARE_ORIGIN}/e/evt_123$`));
    assert.match(html, /<title>Sunset hike<\/title>/);
    assert.ok(html.includes(`<link rel="canonical" href="${SHARE_ORIGIN}/e/evt_123">`));
    assert.ok(html.includes(`<link rel="image_src" href="${image}">`));
  });

  test("event page: logo, title, coarse date, cover card, landing button, one muted line, no meta refresh", () => {
    const html = renderSharePage(buildPreview("evt_123", EVENT));
    assert.ok(html.includes('id="open-app" href="dip://events/evt_123"'));
    assert.ok(html.includes(">Get the app</a>"));
    assert.ok(html.includes('src="/img/landing/app-store.svg"'));
    assert.ok(html.includes('src="/img/landing/logo.svg"'));
    assert.ok(html.includes("<h1>Sunset hike</h1>"));
    assert.ok(html.includes('<p class="date">Fri, Nov 20</p>'));
    assert.ok(html.includes(`<img src="${SHARE_ORIGIN}/share/og/hiking.jpg" alt="Cover image for Sunset hike"`));
    assert.ok(html.includes("Don’t have DIP yet? It’s coming to the App Store."));
    assert.ok(!html.includes("Open in DIP"));
    assert.ok(!html.slice(html.indexOf("<body>")).includes("Bring water")); // description stays in the meta tags only
    assert.ok(!/http-equiv/i.test(html));
    assert.ok(!html.includes("location.replace"));
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.ok(html.includes("fonts.googleapis.com/css2?family=Fjalla+One&family=Figtree"));
  });

  test("generic page: logo, DIP headline, one line, same button to dip://", () => {
    const html = renderSharePage(genericPreview(null));
    assert.ok(html.includes('id="open-app" href="dip://"'));
    assert.ok(html.includes("<h1>DIP</h1>"));
    assert.ok(html.includes("Join activities with your coworkers on DIP."));
    assert.ok(!html.includes('class="cover"'));
    assert.ok(!html.includes('class="date"'));
    assert.ok(!html.includes("Open in DIP"));
    assert.ok(renderSharePage(genericPreview("evt_123")).includes('href="dip://events/evt_123"'));
  });

  test("the official badge variant needs an App Store id and replaces the text link", () => {
    const withId = renderSharePage(buildPreview("evt_123", EVENT), "1234567890", true);
    assert.ok(withId.includes('<img src="/img/landing/app-store-badge.svg" alt="Download on the App Store"'));
    assert.ok(withId.includes('href="https://apps.apple.com/app/id1234567890"'));
    assert.ok(!withId.includes("Get it on the App Store"));
    const withoutId = renderSharePage(buildPreview("evt_123", EVENT), "", true);
    assert.ok(!withoutId.includes("app-store-badge.svg"));
    assert.ok(withoutId.includes("It’s coming to the App Store."));
  });

  test("with an App Store id the muted line links to the listing and nothing redirects on load", () => {
    const html = renderSharePage(buildPreview("evt_123", EVENT), "1234567890");
    assert.ok(html.includes('<a href="https://apps.apple.com/app/id1234567890">Get it on the App Store</a>'));
    assert.ok(!html.includes("coming to the App Store"));
    assert.ok(!html.includes("location.replace"));
    assert.match(html, /addEventListener\('click'[^]*document\.hidden[^]*location\.href = "https:\/\/apps\.apple\.com\/app\/id1234567890"/);
    assert.ok(!/http-equiv/i.test(html));
    assert.ok(metaContent(html, "apple-itunes-app")!.startsWith("app-id=1234567890,"));
  });

  test("hostile titles and descriptions are escaped everywhere", () => {
    const html = renderSharePage(buildPreview("evt_123", {
      ...EVENT, title: `<script>alert(1)</script> "quoted" & 'single'`, description: `"><img src=x onerror=alert(1)> \`tick\``,
    }));
    assert.ok(!html.includes("<script>alert"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!/content="[^"]*"[^>]*onerror/.test(html.replace(/&quot;/g, "")));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &amp; &#39;single&#39;"));
    assert.equal(escapeHtml(`<>&"'\``), "&lt;&gt;&amp;&quot;&#39;&#96;");
  });

  test("never leaks venue, address, time of day, company id or attendees", () => {
    const hostile = { ...EVENT, venue: { address: "123 Secret Street", locality: "Pittsburgh", latitude: 40.4406 }, companyId: "co-secret", attendees: ["Alice Attendee"] };
    const html = renderSharePage(buildPreview("evt_123", hostile as unknown as ShareEvent));
    for (const secret of SECRETS) assert.ok(!html.includes(secret), secret);
  });

  test("description: whitespace collapsed, word-boundary truncation with ellipsis, fallbacks", () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const preview = buildPreview("evt_123", { ...EVENT, description: long });
    assert.ok(Array.from(preview.description).length <= 180);
    assert.ok(preview.description.endsWith("…"));
    assert.ok(/word\d+…$/.test(preview.description));
    assert.equal(truncateAtWord("short text", 50), "short text");
    assert.equal(buildPreview("evt_123", { ...EVENT, description: "   " }).description, "Fri, Nov 20 · Join this activity on DIP.");
    assert.equal(buildPreview("evt_123", { ...EVENT, startTime: null, description: "" }).description, "Join this activity on DIP.");
  });

  test("coarse date has no time of day and uses the preview time zone", () => {
    assert.equal(coarseDate(new Date("2026-11-21T02:00:00Z")), "Fri, Nov 20"); // 9pm Eastern the evening before
    assert.equal(coarseDate(null), null);
    assert.equal(coarseDate(new Date("nope")), null);
  });

  test("missing fields fall back safely", () => {
    const preview = buildPreview("evt_123", { title: "T", description: "", startTime: null, coverImageURL: "", status: "scheduled" });
    assert.equal(preview.imageURL, `${SHARE_ORIGIN}/share/og/default.jpg`);
    assert.equal(buildPreview("evt_123", { ...EVENT, title: "  \n " }).isEvent, false);
  });

  test("cancelled, draft and unknown events give the identical generic page", () => {
    const generic = renderSharePage(genericPreview("evt_123"));
    for (const event of [null, { ...EVENT, status: "cancelled" }, { ...EVENT, status: "draft" }, { ...EVENT, status: "" }]) {
      assert.equal(renderSharePage(buildPreview("evt_123", event)), generic);
    }
    assert.equal(metaContent(generic, "og:title"), "DIP");
    assert.equal(metaContent(generic, "og:image"), `${SHARE_ORIGIN}/share/og/default.jpg`);
    assert.ok(!generic.includes("Sunset"));
  });

  test("images: catalog mapping, approved https hosts only, never arbitrary URLs", () => {
    assert.equal(resolveImage("catalog://default/games").url, `${SHARE_ORIGIN}/share/og/games.jpg`);
    assert.equal(resolveImage("catalog://default/../x").url, `${SHARE_ORIGIN}/share/og/default.jpg`);
    assert.equal(resolveImage("https://evil.example/a.jpg").url, `${SHARE_ORIGIN}/share/og/default.jpg`);
    assert.equal(resolveImage("http://team05-dip.web.app/a.jpg").url, `${SHARE_ORIGIN}/share/og/default.jpg`);
    assert.equal(resolveImage(`${SHARE_ORIGIN}.evil.example/a.jpg`).url, `${SHARE_ORIGIN}/share/og/default.jpg`);
    assert.equal(resolveImage(`${SHARE_ORIGIN}/a.jpg?x="y`).url, `${SHARE_ORIGIN}/share/og/default.jpg`);
    const storage = "https://firebasestorage.googleapis.com/v0/b/team05-dip.appspot.com/o/a.jpg?alt=media";
    assert.deepEqual(resolveImage(storage), { url: storage, standard: false });
    const html = renderSharePage(buildPreview("evt_123", { ...EVENT, coverImageURL: storage }));
    assert.equal(metaContent(html, "og:image:width"), null);
  });

  test("every catalog category in APPROVED_COVER_URLS has a committed 1200x630-style JPEG under 300KB", () => {
    const source = readFileSync(new URL("../../functions/src/modules/organizer/domain/eventDraft.ts", import.meta.url), "utf8");
    const categories = [...source.matchAll(/catalog:\/\/default\/(\w+)/g)].map((m) => m[1]!);
    assert.ok(categories.length >= 5);
    for (const category of [...categories, "default"]) {
      const bytes = readFileSync(new URL(`../../../apps/admin/public/share/og/${category}.jpg`, import.meta.url));
      assert.ok(bytes.length < 300_000, category);
      assert.equal(bytes[0], 0xff); // JPEG magic
      // Baseline/progressive SOF marker carries height then width.
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1]!;
        if (marker >= 0xc0 && marker <= 0xc2) { assert.equal(bytes.readUInt16BE(i + 5), 630); assert.equal(bytes.readUInt16BE(i + 7), 1200); break; }
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
  });

  test("path parsing accepts only /e/<opaque id>", () => {
    assert.equal(parseEventIdFromPath("/e/abc_DEF-123"), "abc_DEF-123");
    assert.equal(parseEventIdFromPath("/e/abc/"), "abc");
    for (const bad of ["/e/", "/e", "/x/abc", "/e/a/b", "/e/%E0%A4%A", "/e/a%20b", `/e/${"a".repeat(129)}`, "/e/<script>"]) assert.equal(parseEventIdFromPath(bad), null, bad);
  });

  test("SHARE_ORIGIN matches DIPShareLink.baseURL", () => {
    const swift = readFileSync(new URL("../../../ui/Packages/DIPCore/Sources/DIPCore/DIPShareLink.swift", import.meta.url), "utf8");
    assert.ok(swift.includes(`URL(string: "${SHARE_ORIGIN}")`));
  });
});

describe("share page service and transport", () => {
  const store = (event: ShareEvent | null | "throw"): ShareEventStore & { calls: string[] } => ({
    calls: [],
    async findEvent(id) { this.calls.push(id); if (event === "throw") throw new Error("boom"); return event; },
  });
  function fakeRes() {
    const out = { code: 0, headers: {} as Record<string, string>, body: "" };
    const res: ShareResponse = {
      status(code) { out.code = code; return res; },
      set(headers) { Object.assign(out.headers, headers); return res; },
      send(body) { out.body = body; return undefined; },
    };
    return { res, out };
  }

  test("one lookup per request; malformed paths never hit the store", async () => {
    const s = store(EVENT);
    const ok = await getSharePage(s, "/e/evt_123");
    assert.ok(ok.html.includes("Sunset hike"));
    await getSharePage(s, "/e/bad%2Fid");
    assert.deepEqual(s.calls, ["evt_123"]);
  });

  test("store failures and timeouts yield the generic page flagged transient", async () => {
    const failed = await getSharePage(store("throw"), "/e/evt_123");
    assert.equal(failed.transientFailure, true);
    assert.ok(!failed.html.includes("Sunset"));
    const slow: ShareEventStore = { findEvent: () => new Promise(() => undefined) };
    const timedOut = await getSharePage(slow, "/e/evt_123", 20);
    assert.equal(timedOut.transientFailure, true);
  });

  test("GET returns 200 with cache and robots headers; unknown ids look like cancelled ones", async () => {
    const a = fakeRes();
    await handleSharePage(store(null), { method: "GET", path: "/e/evt_123" }, a.res);
    const b = fakeRes();
    await handleSharePage(store({ ...EVENT, status: "cancelled" }), { method: "HEAD", path: "/e/evt_123" }, b.res);
    assert.equal(a.out.code, 200);
    assert.equal(b.out.code, 200);
    assert.equal(a.out.headers["Cache-Control"], "public, max-age=300, s-maxage=600");
    assert.equal(a.out.headers["X-Robots-Tag"], "noindex");
    assert.match(a.out.headers["Content-Type"]!, /^text\/html; charset=utf-8$/);
    assert.equal(a.out.body, b.out.body);
  });

  test("other methods get 405 and never read", async () => {
    const s = store(EVENT);
    const c = fakeRes();
    await handleSharePage(s, { method: "POST", path: "/e/evt_123" }, c.res);
    assert.equal(c.out.code, 405);
    assert.equal(c.out.headers.Allow, "GET, HEAD");
    assert.equal(s.calls.length, 0);
  });

  test("transient failures use a short cache", async () => {
    const d = fakeRes();
    await handleSharePage(store("throw"), { method: "GET", path: "/e/evt_123" }, d.res);
    assert.equal(d.out.code, 200);
    assert.equal(d.out.headers["Cache-Control"], "public, max-age=30, s-maxage=30");
  });
});
