import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { routerEmailChannel } from "../../functions/src/modules/email/application/routerChannel";
import type { ChannelDeps } from "../../functions/src/modules/email/application/enqueueEmail";
import type { NewOutboxEntry } from "../../functions/src/modules/email/application/ports";
import { validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import type { NotificationRecipient, NotificationRequest } from "../../functions/src/modules/notifications/application/router";
import type { SubscriptionLevel } from "../../functions/src/modules/notifications/domain/subscription";

const facts = { eventId: "e1", eventTitle: "Sunset hike", startTime: "2026-03-01T18:00:00Z", endTime: "2026-03-01T20:00:00Z" };
const inviteVars = { ...facts, inviterFirstName: "Priya" };

function setup(over: { company?: boolean | null; enabled?: boolean } = {}) {
  const stored = new Map<string, NewOutboxEntry>();
  const deps: ChannelDeps = {
    outbox: {
      create: async (entry) => { if (stored.has(entry.id)) return false; stored.set(entry.id, entry); return true; },
      claim: async () => ({ kind: "missing" }),
      finish: async () => {},
      get: async () => null,
      recordOpen: async () => false,
    },
    clock: { now: () => new Date("2026-03-01T10:00:00Z") },
    validate: validateVariables,
    companies: { get: async () => (over.company === null ? null : { enabled: over.company ?? true, dailyCap: 10, timeZone: null }) },
    preferences: { getEmailMap: async () => null, disable: async () => true },
    config: { enabled: over.enabled ?? true },
  };
  return { stored, channel: routerEmailChannel(deps) };
}

function req(kind: NotificationRequest["kind"], email: NotificationRequest["email"], id = "n1"): NotificationRequest {
  return {
    id, kind, companyId: "c1", recipients: [],
    push: { title: "t", body: "b", category: "invites", threadId: "x", data: { type: kind, companyId: "c1", deepLink: "dip://x" } } as never,
    email,
  };
}
const recipient = (eventLevel: SubscriptionLevel | null = null): NotificationRecipient => ({ uid: "u1", eventLevel });
const invite = { template: "invite_received", variables: inviteVars, objectId: "e1", revisionOrWindow: "r1" };

describe("routerEmailChannel", () => {
  test("valid invite payload enqueues once; a second deliver is idempotent", async () => {
    const { stored, channel } = setup();
    assert.equal(await channel.deliver(req("invite", invite), recipient(), false), true);
    assert.equal(stored.size, 1);
    const entry = [...stored.values()][0]!;
    assert.equal(entry.uid, "u1");
    assert.equal(entry.companyId, "c1");
    assert.equal(entry.template, "invite_received");
    assert.equal(await channel.deliver(req("invite", invite, "n2"), recipient(), false), false);
    assert.equal(stored.size, 1);
  });

  test("no payload or unknown template stores nothing", async () => {
    const { stored, channel } = setup();
    assert.equal(await channel.deliver(req("invite", undefined), recipient(), false), false);
    assert.equal(await channel.deliver(req("invite", { ...invite, template: "nope" }), recipient(), false), false);
    assert.equal(stored.size, 0);
  });

  test("template category must match the request kind's category", async () => {
    const { stored, channel } = setup();
    assert.equal(await channel.deliver(req("chat", invite), recipient("all"), false), false);
    assert.equal(await channel.deliver(req("reminder", invite), recipient("all"), false), false);
    assert.equal(stored.size, 0);
  });

  test("invalid variables are rejected", async () => {
    const { stored, channel } = setup();
    assert.equal(await channel.deliver(req("invite", { ...invite, variables: { eventId: "e1" } }), recipient(), false), false);
    assert.equal(await channel.deliver(req("invite", { ...invite, variables: null }), recipient(), false), false);
    assert.equal(stored.size, 0);
  });

  test("challenge email is skipped when push will deliver, sent otherwise", async () => {
    const { stored, channel } = setup();
    const challenge = { template: "challenge_reviewed", variables: { challengeId: "ch1", challengeTitle: "Walk", outcome: "approved" }, objectId: "ch1", revisionOrWindow: "r1" };
    assert.equal(await channel.deliver(req("challenge_approved", challenge), recipient(), true), false);
    assert.equal(stored.size, 0);
    assert.equal(await channel.deliver(req("challenge_approved", challenge), recipient(), false), true);
    assert.equal(stored.size, 1);
  });

  test("event_changed needs a sufficient event level; missing level counts as none", async () => {
    const { stored, channel } = setup();
    const changed = { template: "event_changed", variables: { ...facts, changedFields: ["time"] }, objectId: "e1", revisionOrWindow: "r1" };
    assert.equal(await channel.deliver(req("event_changed", changed), recipient(null), true), false);
    assert.equal(stored.size, 0);
    assert.equal(await channel.deliver(req("event_changed", changed), recipient("changes"), true), true);
    assert.equal(stored.size, 1);
  });

  test("company disabled, company settings missing or email globally disabled -> false", async () => {
    for (const over of [{ company: false }, { company: null }, { enabled: false }]) {
      const { stored, channel } = setup(over);
      assert.equal(await channel.deliver(req("invite", invite), recipient(), false), false, JSON.stringify(over));
      assert.equal(stored.size, 0);
    }
  });
});
