import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { PixabayUnavailableError, type PixabayHit } from "../../functions/src/modules/covers/application/livePorts";
import { COVER_INDEX, type CoverIndexEntry } from "../../functions/src/modules/covers/domain/catalog.generated";
import {
  DYNAMIC_KEY_PATTERN, dynamicCoverImagePath, dynamicCoverJpegPath, dynamicKeyFor, dynamicStoragePaths, isDynamicCoverKey, isDynamicCoverURL,
  pixabayIdOfKey, staticPixabayIds, toIndexEntry,
} from "../../functions/src/modules/covers/domain/dynamicCovers";
import {
  assertPixabayImageURL, isAllowedImageContentType, isAllowedPixabayImageURL, MAX_IMAGE_BYTES, normalizeContentType, sniffImageType,
} from "../../functions/src/modules/covers/domain/imageGuards";
import { deterministicLivePick, liveCandidates, liveQuestion, liveTrigger } from "../../functions/src/modules/covers/domain/liveFallback";
import { buildPixabayQuery, coverVocabulary } from "../../functions/src/modules/covers/domain/liveQuery";
import { acceptable, BLOCKED_TAGS, docFieldsFromHit, hitTags, pixabayLicense, popularity, relevance } from "../../functions/src/modules/covers/domain/pixabayRules";
import type { ScoredCover } from "../../functions/src/modules/covers/domain/shortlist";

const hit = (id: number, tags: string, extra: Partial<PixabayHit> = {}): PixabayHit => ({
  id, pageURL: `https://pixabay.com/photos/x-${id}/`, tags, user: "someone", user_id: 7, imageWidth: 1920, imageHeight: 1080,
  largeImageURL: `https://pixabay.com/get/g${id}.jpg`, webformatURL: `https://pixabay.com/get/w${id}.jpg`, ...extra,
});
const entry = (key: string, themes: string[], tags: string[]): CoverIndexEntry => ({
  key, url: `catalog://cover/${key}`, kind: "photo", themes, tags, mood: [], season: ["any"], orientation: "landscape", label: tags.join(" "), alt: `Photo ${tags.join(" ")}`, hasJpeg: true,
});
const scored = (score: number, matched: boolean): ScoredCover => ({ entry: entry(`k${score}-${matched}`, ["food"], ["x"]), score, matched });
const vocab = new Set(["lunch", "pizza", "hiking", "yoga", "picnic", "cookies", "bread", "farewell"]);

describe("dynamic keys", () => {
  test("pattern accepts and rejects", () => {
    for (const ok of ["pixabay-1", "pixabay-123456", "pixabay-999999999999"]) assert.ok(DYNAMIC_KEY_PATTERN.test(ok), ok);
    for (const bad of ["pixabay-0", "pixabay-01", "pixabay-1234567890123", "Pixabay-1", "PIXABAY-1", "pixabay-", "pixabay-1a", "pixabay-1/../x", "../pixabay-1", "pixabay-1\n", " pixabay-1"]) {
      assert.ok(!DYNAMIC_KEY_PATTERN.test(bad), JSON.stringify(bad));
      assert.equal(isDynamicCoverKey(bad), false);
    }
    assert.equal(isDynamicCoverKey(5), false);
  });

  test("key, id and URL helpers", () => {
    assert.equal(dynamicKeyFor(42), "pixabay-42");
    assert.throws(() => dynamicKeyFor(0));
    assert.throws(() => dynamicKeyFor(1.5));
    assert.throws(() => dynamicKeyFor(10 ** 12));
    assert.equal(pixabayIdOfKey("pixabay-42"), 42);
    assert.equal(pixabayIdOfKey("pixabay-042"), null);
    assert.equal(pixabayIdOfKey("campfire-1"), null);
    assert.ok(isDynamicCoverURL("catalog://cover/pixabay-42"));
    assert.ok(!isDynamicCoverURL("catalog://cover/campfire-night-1835829"));
    assert.ok(!isDynamicCoverURL("catalog://default/outdoors"));
    assert.ok(!isDynamicCoverURL(undefined));
    assert.equal(dynamicCoverImagePath("pixabay-42"), "/img/covers-dyn/pixabay-42.webp");
    assert.equal(dynamicCoverJpegPath("pixabay-42"), "/img/covers-dyn/jpg/pixabay-42.jpg");
    assert.deepEqual(dynamicStoragePaths("pixabay-42"), { webp: "covers-dynamic/pixabay-42.webp", jpeg: "covers-dynamic/jpg/pixabay-42.jpg" });
  });

  test("toIndexEntry builds a landscape photo entry", () => {
    const e = toIndexEntry({ key: "pixabay-42", themes: ["food"], tags: ["pizza", "oven"], label: "Pizza, oven", alt: "Photo of pizza and oven" });
    assert.deepEqual(e, {
      key: "pixabay-42", url: "catalog://cover/pixabay-42", kind: "photo", themes: ["food"], tags: ["pizza", "oven"], mood: [], season: ["any"],
      orientation: "landscape", label: "Pizza, oven", alt: "Photo of pizza and oven", hasJpeg: true,
    });
  });

  test("staticPixabayIds reads trailing ids of the real index", () => {
    const ids = staticPixabayIds(COVER_INDEX);
    assert.ok(ids.has(1835829));
    assert.ok(ids.size > 100);
    assert.deepEqual([...staticPixabayIds([entry("theme-music", ["music"], ["a"]), entry("x-12", ["music"], ["a"])])], [12]);
  });
});

describe("live query", () => {
  const q = (title: string, description?: string) => buildPixabayQuery({ title, ...(description === undefined ? {} : { description }), theme: "food" }, vocab);

  test("title words in the vocabulary lead, at most 4 words", () => {
    assert.deepEqual(q("Office pizza lunch with everyone")?.words, ["pizza", "lunch"], "office is generic");
    const many = q("alpha bravo charlie delta echo foxtrot", "")!;
    assert.equal(many.words.length, 4);
    assert.ok(many.q.length <= 100);
    assert.equal(many.q, many.words.join(" "));
  });

  test("strips emails, phones, URLs, handles and digits", () => {
    const r = q("Yoga 2024 call +1 (555) 123-4567", "Mail jane.doe@example.com or visit https://evil.example/x?id=7 or www.foo.com, ping @jane_d, room 12b, bread")!;
    const text = r.words.join(" ");
    assert.deepEqual(r.words.slice(0, 2), ["yoga", "call"]);
    assert.ok(!/[0-9@:/.]/.test(r.q));
    for (const bad of ["jane", "doe", "example", "evil", "mail", "foo", "visit"]) assert.ok(!text.split(" ").includes(bad), bad);
  });

  test("drops names before a possessive and capitalized mid-sentence names in the description", () => {
    assert.deepEqual(q("Sarah's farewell lunch")?.words, ["farewell", "lunch"]);
    assert.deepEqual(q("Sarah’s farewell lunch")?.words, ["farewell", "lunch"]);
    const r = q("Team picnic", "Join us. Priya and Marcus bring cookies. Alexander makes bread. Tom's pizza too.")!;
    assert.deepEqual(r.words, ["picnic", "cookies", "bread", "pizza"].filter(w => r.words.includes(w)));
    assert.ok(!r.words.some(w => ["priya", "marcus", "alexander", "join"].includes(w)));
    assert.ok(!r.words.includes("tom"));
    assert.ok(r.words.includes("cookies") && r.words.includes("bread"));
  });

  test("description words only count when in the vocabulary, ordered by frequency", () => {
    const r = q("Gathering", "yoga yoga picnic zebra yoga picnic bread")!;
    assert.deepEqual(r.words, ["yoga", "picnic", "bread"], "gathering is generic; zebra is not a library word");
  });

  test("theme fallback and null", () => {
    assert.deepEqual(q("12:30 @ the 5th", "")?.words, ["food"]);
    assert.equal(buildPixabayQuery({ title: "!!! 123", description: "a an the" }, vocab), null);
    assert.deepEqual(buildPixabayQuery({ title: "x", tagIds: ["tag-music"] }, vocab)?.words, ["music"]);
  });

  test("coverVocabulary collects tag and label words", () => {
    const v = coverVocabulary([entry("a", ["food"], ["pizza oven", "Bread"])]);
    assert.ok(v.has("pizza") && v.has("oven") && v.has("bread"));
  });
});

describe("live trigger", () => {
  const config = { minScore: 6, minMatches: 2 };
  test("low score", () => {
    const t = liveTrigger([scored(5, true), scored(4, true), scored(3, true)], config);
    assert.deepEqual(t, { trigger: true, reason: "low_score", bestScore: 5, matchedCount: 3 });
  });
  test("few matches", () => {
    const t = liveTrigger([scored(9, true), scored(8, false), scored(0, true)], config);
    assert.deepEqual(t, { trigger: true, reason: "few_matches", bestScore: 9, matchedCount: 1 });
  });
  test("no trigger with good matches, boundaries inclusive", () => {
    assert.deepEqual(liveTrigger([scored(6, true), scored(1, true)], config), { trigger: false, reason: null, bestScore: 6, matchedCount: 2 });
    assert.equal(liveTrigger([scored(5.99, true), scored(1, true)], config).trigger, true);
    assert.equal(liveTrigger([scored(6, true), scored(1, true)], { minScore: 6, minMatches: 3 }).trigger, true);
  });
  test("empty ranking triggers", () => {
    assert.deepEqual(liveTrigger([], config), { trigger: true, reason: "low_score", bestScore: 0, matchedCount: 0 });
  });
});

describe("pixabay rules", () => {
  test("acceptable: blocked tags, ratio, width", () => {
    assert.ok(acceptable(hit(1, "pizza, oven")));
    for (const tag of ["kids", "logo", "children playing", "Billboard", "sign-board"]) assert.equal(acceptable(hit(1, `pizza, ${tag}`)), false, tag);
    assert.ok(acceptable(hit(1, "design, designer")));
    assert.equal(acceptable(hit(1, "a", { imageWidth: 1920, imageHeight: 1300 })), false);
    assert.equal(acceptable(hit(1, "a", { imageWidth: 1920, imageHeight: 800 })), false);
    assert.ok(acceptable(hit(1, "a", { imageWidth: 1500, imageHeight: 1000 })));
    assert.equal(acceptable(hit(1, "a", { imageWidth: 1200, imageHeight: 700 })), false);
    assert.ok(acceptable(hit(1, "a", { imageWidth: 1200, imageHeight: 700 }), 1000));
    assert.ok(BLOCKED_TAGS.includes("watermark"));
  });
  test("hitTags, relevance, popularity, license", () => {
    assert.deepEqual(hitTags(hit(1, " Pizza ,OVEN,, ")), ["pizza", "oven"]);
    assert.equal(relevance(hit(1, "pizza, wood oven"), ["pizza", "the", "ovens"]), 1);
    assert.equal(relevance(hit(1, "pizza"), ["pizza", "hiking"]), 0.5);
    assert.equal(relevance(hit(1, "pizza"), []), 0);
    assert.equal(popularity(hit(1, "a")), 0);
    assert.ok(popularity({ ...hit(1, "a"), likes: 100, downloads: 1000, views: 5000 }) > 2);
    const l = pixabayLicense(hit(5, "a, b"));
    assert.equal(l.type, "pixabay");
    assert.ok(l.notes.length <= 300 && l.creatorURL === "https://pixabay.com/users/someone-7/");
  });
});

describe("live candidates", () => {
  test("filters, excludes, dedupes, ranks, caps", () => {
    const hits = [
      hit(1, "hiking, trail"),
      hit(2, "yoga, kids"),
      hit(3, "yoga, studio"),
      hit(3, "yoga, studio"),
      hit(4, "yoga, mat", { imageWidth: 1000, imageHeight: 600 }),
      hit(5, "yoga, mat, studio"),
      hit(6, "yoga, logo"),
      hit(7, "yoga", { imageWidth: 1920, imageHeight: 1300 }),
      hit(8, "yoga, pose"),
    ];
    const out = liveCandidates(hits, ["yoga", "studio"], { excludeIds: new Set([8]), max: 3 });
    assert.deepEqual(out.map(h => h.id), [3, 5, 1]);
    assert.deepEqual(liveCandidates(hits, ["yoga"], { excludeIds: new Set(), max: 2 }).map(h => h.id), [3, 5]);
    assert.deepEqual(liveCandidates(hits, ["yoga"], { excludeIds: new Set(), max: 0 }), []);
  });
});

describe("live question and pick", () => {
  const top = [1, 2, 3, 4].map(n => scored(n, true));
  test("keys and options", () => {
    const tags = "a1, b2, c3, d4, e5, f6, g7, h8, i9, j10";
    const q = liveQuestion([hit(11, tags), hit(12, "")], top);
    assert.equal(q.type, "choice");
    if (q.type !== "choice") return;
    assert.match(q.instructions, /described only by its tags/);
    const keys = Object.keys(q.criteria);
    assert.deepEqual(keys.slice(0, 2), ["pixabay-11", "pixabay-12"]);
    assert.equal(q.criteria["pixabay-11"], "a1, b2, c3, d4, e5, f6, g7, h8");
    assert.equal(q.criteria["pixabay-12"], "photo");
    assert.equal(keys.length, 5);
    assert.ok(q.criteria[top[0]!.entry.key]!.includes(" | "));
    assert.ok(!JSON.stringify(q).includes("https://"));
  });
  test("deterministicLivePick threshold", () => {
    const a = hit(1, "yoga, mat");
    const b = hit(2, "pizza");
    assert.equal(deterministicLivePick([b, a], ["yoga", "studio"])?.id, 1);
    assert.equal(deterministicLivePick([b], ["yoga", "studio"]), null);
    assert.equal(deterministicLivePick([a], ["yoga", "studio", "class"]), null);
    assert.equal(deterministicLivePick([a], []), null);
    assert.equal(deterministicLivePick([hit(3, "yoga"), hit(4, "yoga, studio")], ["yoga", "studio"])?.id, 4);
  });
});

describe("docFieldsFromHit", () => {
  test("removes blocked tags, bounds label and alt, maps themes", () => {
    const f = docFieldsFromHit(hit(1, "pizza, KIDS, logo, oven, kitchen"), ["food"], [entry("a", ["food"], ["pizza", "oven"]), entry("b", ["food", "arts"], ["pizza"])]);
    assert.deepEqual(f.tags, ["pizza", "oven", "kitchen"]);
    assert.equal(f.label, "Pizza, oven, kitchen");
    assert.equal(f.alt, "Photo of pizza, oven and kitchen");
    assert.deepEqual(f.themes, ["food", "arts"]);
  });
  test("caps tags at 12, label at 40, alt at 160 and themes at 3", () => {
    const long = Array.from({ length: 20 }, (_, i) => `averyverylongtagword${i}`).join(", ");
    const f = docFieldsFromHit(hit(1, long));
    assert.equal(f.tags.length, 12);
    assert.ok(f.label.length <= 40 && f.label.length > 0);
    assert.ok(f.alt.length <= 160);
    const idx = [entry("a", ["food", "arts", "music", "games"], ["t"])];
    assert.equal(docFieldsFromHit(hit(1, "t"), [], idx).themes.length, 3);
  });
  test("theme fallback: query themes, then outdoors; invalid themes ignored", () => {
    assert.deepEqual(docFieldsFromHit(hit(1, "zzzqqq"), ["music", "bogus"], []).themes, ["music"]);
    assert.deepEqual(docFieldsFromHit(hit(1, "zzzqqq"), ["bogus"], []).themes, ["outdoors"]);
    assert.deepEqual(docFieldsFromHit(hit(1, "zzzqqq"), undefined, []).themes, ["outdoors"]);
  });
  test("no usable tags", () => {
    const f = docFieldsFromHit(hit(1, "kids, logo"), [], []);
    assert.deepEqual([f.tags, f.label, f.alt], [[], "Photo", "Photo"]);
  });
});

describe("image guards", () => {
  test("URL guard accepts Pixabay image URLs only", () => {
    for (const ok of ["https://pixabay.com/get/abc_1280.jpg", "https://cdn.pixabay.com/photo/2020/01/01/x_1280.jpg", "https://pixabay.com/get/a?x=1"]) {
      assert.ok(isAllowedPixabayImageURL(ok), ok);
      assert.equal(assertPixabayImageURL(ok).hostname, new URL(ok).hostname);
    }
    const bad = [
      "http://pixabay.com/get/a.jpg", "https://evil.com/get/a.jpg", "https://pixabay.com.evil.com/get/a.jpg", "https://evilpixabay.com/get/a.jpg",
      "https://user:pass@pixabay.com/get/a.jpg", "https://pixabay.com:8443/get/a.jpg", "https://pixabay.com/photo/a.jpg", "https://pixabay.com/api/?key=x",
      "https://cdn.pixabay.com/get/a.jpg", "https://cdn.pixabay.com/video/a.mp4", "https://sub.cdn.pixabay.com/photo/a.jpg", "https://pixabay.com./get/a.jpg",
      "https://pixabay.com\\@evil.com/get/a.jpg", "https://127.0.0.1/get/a.jpg", "https://[::1]/get/a.jpg", "https://169.254.169.254/photo/a.jpg",
      "ftp://pixabay.com/get/a.jpg", "javascript:alert(1)", "not a url", "",
    ];
    for (const url of bad) {
      assert.equal(isAllowedPixabayImageURL(url), false, url);
      assert.throws(() => assertPixabayImageURL(url), (e: unknown) => e instanceof PixabayUnavailableError && e.reason === "url_rejected" && !e.message.includes("evil"));
    }
  });
  test("magic bytes", () => {
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
    assert.equal(sniffImageType(webp), "image/webp");
    assert.equal(sniffImageType(Buffer.from("GIF89a....")), null);
    assert.equal(sniffImageType(Buffer.from("<!doctype html><html>")), null);
    assert.equal(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])), null);
    assert.equal(sniffImageType(new Uint8Array(0)), null);
    assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8])), null);
  });
  test("content types and size cap", () => {
    assert.equal(normalizeContentType("image/JPEG; charset=binary"), "image/jpeg");
    assert.equal(normalizeContentType(" image/webp "), "image/webp");
    assert.equal(normalizeContentType("image/png"), "image/png");
    for (const bad of ["image/gif", "text/html", "image/svg+xml", "", null, "image/jpeg2"]) {
      assert.equal(normalizeContentType(bad), null, String(bad));
      assert.equal(isAllowedImageContentType(bad), false);
    }
    assert.ok(isAllowedImageContentType("image/png; foo=bar"));
    assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  });
});
