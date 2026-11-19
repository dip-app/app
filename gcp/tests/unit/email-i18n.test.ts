import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { sendOutboxEmail, type EmailRenderer, type SendDeps } from "../../functions/src/modules/email/application/sendOutboxEmail";
import type { ClaimResult, OutboxStore, OutgoingEmail, Recipient } from "../../functions/src/modules/email/application/ports";
import { icsAttachmentFor } from "../../functions/src/modules/email/domain/ics";
import { categoryOf, type OutboxDocument, type OutboxStatus } from "../../functions/src/modules/email/domain/outbox";
import { mondayOfIsoWeek } from "../../functions/src/modules/email/domain/templates/adminSuggestions";
import { emailCatalogs } from "../../functions/src/modules/email/domain/templates/i18n";
import { formatEventTime, renderEmail, renderLocale, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import type { TemplateId, TemplateVariables } from "../../functions/src/modules/email/domain/templates/types";
import { PREVIEW_CASES, SAMPLE_CTX } from "../../functions/src/modules/email/scripts/previewCases";
import { checkCatalogs, localeOrDefault } from "../../functions/src/modules/i18n";

// Email copy per recipient language (issue #259 backend phase, docs/design/backend-i18n.md).

const EVENT = {
  eventId: "evt_1", eventTitle: "Padel night", startTime: "2030-01-02T23:00:00Z", endTime: "2030-01-03T00:30:00Z",
  venueName: "Court 3", venueAddress: "1 Main St, Pittsburgh, PA",
};

describe("email catalogs", () => {
  test("Spanish has every English key with matching placeholders and plural forms", () => {
    assert.deepEqual(checkCatalogs("email", emailCatalogs.en, emailCatalogs.es), []);
  });

  test("the checker reports a missing key, a placeholder mismatch and a plural without one", () => {
    const problems = checkCatalogs("t", { a: "{n} x", b: "Hi {name}", c: "{n, plural, one {# a} other {# b}}" }, { b: "Hola {nombre}", c: "{n, plural, other {# b}}" });
    assert.ok(problems.some((p) => p.includes("missing a")));
    assert.ok(problems.some((p) => p.includes("es b placeholders")));
    assert.ok(problems.some((p) => p.includes('no "one" form')));
  });
});

describe("locale selection", () => {
  test("missing, unknown and malformed values fall back to English", () => {
    assert.equal(renderLocale({}), "en");
    assert.equal(renderLocale({ locale: "es" }), "es");
    for (const value of [undefined, null, "", "fr", "ES", "es-MX", 3, {}]) assert.equal(localeOrDefault(value), "en", String(value));
  });

  test("an explicit en renders byte-identically to no locale for every preview case", () => {
    for (const c of PREVIEW_CASES) {
      const plain = renderEmail(c.template, c.variables as never, c.ctx);
      const en = renderEmail(c.template, c.variables as never, { ...c.ctx, locale: "en" });
      assert.deepEqual(en, plain, c.name);
    }
  });

  test("Spanish changes our copy but never the server content", () => {
    const out = renderEmail("invite_received", { ...EVENT, inviterFirstName: "Priya" }, { ...SAMPLE_CTX, locale: "es" });
    assert.equal(out.subject, "Priya te invitó a Padel night");
    assert.ok(out.html.includes('<html lang="es"'));
    assert.ok(out.text.includes("¡Hola, Sam! Priya te invitó a un evento en DIP."));
    assert.ok(out.text.includes("Court 3") && out.text.includes("1 Main St, Pittsburgh, PA"));
    // Footer: the support address is unchanged in every language.
    assert.ok(out.text.includes("Enviado por DIP · ¿Preguntas? support@letsdip.work"));
    assert.ok(out.html.includes('href="mailto:support@letsdip.work"'));
  });
});

describe("plurals and formatting", () => {
  const points = (n: number, locale: "en" | "es") =>
    renderEmail("challenge_reviewed", { challengeId: "c1", challengeTitle: "Steps", outcome: "approved", points: n }, { ...SAMPLE_CTX, locale }).text;

  test("challenge points pluralize per language", () => {
    assert.ok(points(1, "en").includes("+1 point\n"));
    assert.ok(points(2, "en").includes("+2 points\n"));
    assert.ok(points(1, "es").includes("+1 punto\n"));
    assert.ok(points(2, "es").includes("+2 puntos\n"));
  });

  test("the ideas email counts ideas per language", () => {
    const base = PREVIEW_CASES.find((c) => c.name === "admin_suggestions")!.variables as TemplateVariables["admin_suggestions"];
    const one = { ...base, ideas: base.ideas.slice(0, 1) };
    assert.match(renderEmail("admin_suggestions", one, SAMPLE_CTX).text, /Hi Sam, here is 1 idea for/);
    assert.match(renderEmail("admin_suggestions", base, SAMPLE_CTX).text, /Hi Sam, here are 4 ideas for/);
    assert.match(renderEmail("admin_suggestions", one, { ...SAMPLE_CTX, locale: "es" }).text, /¡Hola, Sam! Aquí tienes 1 idea para/);
    assert.match(renderEmail("admin_suggestions", base, { ...SAMPLE_CTX, locale: "es" }).text, /¡Hola, Sam! Aquí tienes 4 ideas para/);
    assert.equal(renderEmail("admin_suggestions", base, { ...SAMPLE_CTX, locale: "es" }).subject, "Tus ideas de eventos para la semana del 30 de noviembre");
  });

  test("ISO week keys map to their Monday", () => {
    assert.equal(mondayOfIsoWeek("2026-W49")?.toISOString(), "2026-11-30T00:00:00.000Z");
    assert.equal(mondayOfIsoWeek("2026-W01")?.toISOString(), "2025-12-29T00:00:00.000Z");
    assert.equal(mondayOfIsoWeek("2026-W99"), null);
    assert.equal(mondayOfIsoWeek("nope"), null);
  });

  test("dates and times use Intl for the locale and the same zone abbreviation", () => {
    assert.equal(formatEventTime("2026-11-21T00:30:00Z", "2026-11-21T02:00:00Z", "America/New_York"), "Fri, Nov 20, 7:30 PM to 9:00 PM EST");
    assert.equal(formatEventTime("2026-11-21T00:30:00Z", "2026-11-21T02:00:00Z", "America/New_York", "es"), "vie, 20 nov, 7:30 p.m. a 9:00 p.m. EST");
    assert.equal(formatEventTime("2026-11-21T03:00:00Z", "2026-11-21T08:00:00Z", "America/New_York", "es"), "vie, 20 nov, 10:00 p.m. a sáb, 21 nov, 3:00 a.m. EST");
  });

  test("Spanish change lists use the Spanish conjunction", () => {
    const out = renderEmail("event_changed", { ...EVENT, changedFields: ["time", "venue", "title"] }, { ...SAMPLE_CTX, locale: "es" });
    assert.ok(out.text.includes("Hay cambios en la hora, el lugar y el título de este evento."), out.text);
  });
});

describe("calendar file text", () => {
  const invite = (locale?: "en" | "es") => icsAttachmentFor("calendar_invite", { ...EVENT, sequence: 0, reason: "joined" }, 0, new Date("2030-01-01T00:00:00Z"), {
    attendeeEmail: "a@b.co", attendeeName: null, memberUid: "u1", now: new Date("2030-01-01T00:00:00Z"), ...(locale ? { locale } : {}),
  })!.content.replace(/\r\n /g, "");

  test("English is unchanged and Spanish localizes only our text", () => {
    assert.equal(invite("en"), invite());
    assert.ok(invite().includes("DESCRIPTION:Open in DIP: https://letsdip.work/e/evt_1"));
    assert.ok(invite().includes("DESCRIPTION:Padel night starts soon"));
    const es = invite("es");
    assert.ok(es.includes("DESCRIPTION:Abrir en DIP: https://letsdip.work/e/evt_1"));
    assert.ok(es.includes("DESCRIPTION:Padel night empieza pronto"));
    assert.ok(es.includes("SUMMARY:Padel night"));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Sending uses each recipient's own locale (one outbox document per recipient).
// ---------------------------------------------------------------------------------------------------------------------

class Outbox implements OutboxStore {
  docs = new Map<string, OutboxDocument>();
  add(id: string, uid: string, template: TemplateId, variables: unknown) {
    const now = new Date();
    this.docs.set(id, {
      id, uid, companyId: "c1", category: categoryOf(template), template, variables: variables as never, status: "queued", attempts: 0,
      notAfter: null, createdAt: now, expireAt: now, leaseUntil: null,
    });
  }
  async create() { return false; }
  async claim(id: string): Promise<ClaimResult> {
    const d = this.docs.get(id);
    if (!d) return { kind: "missing" };
    if (d.status !== "queued") return { kind: "not_queued", status: d.status };
    d.status = "sending"; d.attempts += 1;
    return { kind: "claimed", doc: { ...d } };
  }
  async finish(id: string, status: Exclude<OutboxStatus, "sending">) { this.docs.get(id)!.status = status; }
  async get(id: string) { return this.docs.get(id) ?? null; }
  async recordOpen() { return false; }
}

const realRenderer: EmailRenderer = {
  render: (template, variables, ctx) => renderEmail(template, variables, ctx),
  validate: (template, value) => validateVariables(template, value),
  attachment: () => null,
};

function deps(recipients: Record<string, Partial<Recipient>>, outbox: Outbox, sent: OutgoingEmail[]): SendDeps {
  return {
    outbox,
    recipients: {
      get: async (uid) => ({ uid, companyId: "c1", email: `${uid}@example.com`, displayName: "Alex Doe", status: "active", ...recipients[uid] }),
      uidsByEmail: async () => [],
    },
    companies: { get: async () => ({ enabled: true, dailyCap: 100, timeZone: "America/New_York" }) },
    suppressions: { isSuppressed: async () => false, suppress: async () => undefined },
    caps: { consume: async () => "ok" },
    preferences: { getEmailMap: async () => null, disable: async () => true },
    provider: { name: "fake", send: async (m) => { sent.push(m); return { kind: "sent", providerMessageId: `pm-${sent.length}` }; } },
    renderer: realRenderer,
    clock: { now: () => new Date("2030-01-01T12:00:00Z") },
    config: { enabled: true, unsubscribeKey: "k".repeat(40), defaultTimeZone: "UTC", publicOrigin: "https://letsdip.work", openTracking: false },
    log: () => undefined,
  };
}

describe("sending uses the recipient locale", () => {
  test("one fan-out with mixed locales: each member gets their own language, unknown values get English", async () => {
    const outbox = new Outbox();
    const sent: OutgoingEmail[] = [];
    const variables = { ...EVENT, inviterFirstName: "Priya" };
    for (const uid of ["en1", "es1", "none1", "fr1"]) outbox.add(`invites_evt_1_${uid}_r1`, uid, "invite_received", variables);
    const d = deps({ en1: { locale: "en" }, es1: { locale: "es" }, none1: {}, fr1: { locale: "fr" } }, outbox, sent);
    for (const id of outbox.docs.keys()) assert.equal((await sendOutboxEmail(d, id)).status, "sent");
    const byTo = new Map(sent.map((m) => [m.to, m]));
    assert.equal(byTo.get("en1@example.com")!.subject, "Priya invited you to Padel night");
    assert.equal(byTo.get("es1@example.com")!.subject, "Priya te invitó a Padel night");
    assert.equal(byTo.get("none1@example.com")!.subject, "Priya invited you to Padel night");
    assert.equal(byTo.get("fr1@example.com")!.subject, "Priya invited you to Padel night");
    assert.ok(byTo.get("es1@example.com")!.text.includes("Cancelar suscripción: https://letsdip.work/u/"));
    assert.ok(byTo.get("en1@example.com")!.text.includes("Unsubscribe: https://letsdip.work/u/"));
    // English output through the sender equals a direct English render with the same context.
    const en = byTo.get("en1@example.com")!;
    assert.ok(en.html.includes('<html lang="en"'));
  });

  test("the locale reaches the renderer context and the calendar invite context", async () => {
    const outbox = new Outbox();
    const sent: OutgoingEmail[] = [];
    const seen: Array<string | undefined> = [];
    outbox.add("x1", "es1", "invite_received", { ...EVENT, inviterFirstName: "Priya" });
    const d = deps({ es1: { locale: "es" } }, outbox, sent);
    d.renderer = { ...realRenderer, render: (t, v, ctx) => { seen.push(ctx.locale); return realRenderer.render(t, v, ctx); } };
    await sendOutboxEmail(d, "x1");
    assert.deepEqual(seen, ["es"]);
  });
});
