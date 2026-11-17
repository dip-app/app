import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  attendeeAddedRequest, challengeReviewedRequest, inviteAnsweredRequest, RoutedPushNotifier, runWeeklyThemePushes, themesStartedWithin,
  weeklyThemeRequest, type Deliver,
} from "../../functions/src/modules/notifications/application/newTriggers";
import type { NotificationRequest } from "../../functions/src/modules/notifications/application/router";
import type { MemberPager, WeeklyTheme, WeeklyThemeReader } from "../../functions/src/modules/notifications/application/routerPorts";
import { NOTIFICATION_KINDS } from "../../functions/src/modules/notifications/domain/categories";
import {
  attendeeAddedPush, challengeReviewedPush, inviteAnsweredPush, weeklyThemePush, type PushMessage,
} from "../../functions/src/modules/notifications/domain/push";

// The deep-link pattern of the push JSON contract (contracts/v1).
const DEEP_LINK = /^dip:\/\/(events\/[A-Za-z0-9_-]+(\/chat)?|challenges(\/[A-Za-z0-9_-]+)?)$/;
const wellFormed = (push: PushMessage) => {
  assert.match(push.data.deepLink, DEEP_LINK);
  assert.equal(push.data.category, push.category);
  assert.ok(push.threadId.length > 0 && push.collapseId && push.collapseId.length > 0);
  assert.doesNotMatch(`${push.title} ${push.body}`, /@/);
  for (const value of Object.values(push.data)) assert.equal(typeof value, "string");
};

test("attendeeAddedPush: copy, deep link, category, type", () => {
  const push = attendeeAddedPush("c1", "ev1", "Sunset run");
  wellFormed(push);
  assert.equal(push.title, "You were added to an activity");
  assert.equal(push.body, "An organizer added you to Sunset run.");
  assert.equal(push.data.type, "attendee_added");
  assert.equal(push.data.deepLink, "dip://events/ev1");
  assert.equal(push.data.eventId, "ev1");
  assert.equal(push.category, "event_updates");
  assert.equal(push.threadId, "event-ev1");
  assert.equal(push.expiresAt, undefined);
  assert.ok(attendeeAddedPush("c1", "ev1", "x".repeat(200)).body.length < 90);
});

test("inviteAnsweredPush: accepted copy, names capped at 40 characters, invites category", () => {
  const push = inviteAnsweredPush("c1", "ev1", "Pasta Night", "ev1_friend", "Fran Friend");
  wellFormed(push);
  assert.equal(push.body, "Fran Friend accepted your invite to Pasta Night.");
  assert.equal(push.data.type, "invite_answered");
  assert.equal(push.data.inviteId, "ev1_friend");
  assert.equal(push.data.deepLink, "dip://events/ev1");
  assert.equal(push.category, "invites");
  assert.equal(push.threadId, "invites");
  const long = inviteAnsweredPush("c1", "ev1", "Pasta Night", "i", "N".repeat(100));
  assert.ok(long.body.startsWith(`${"N".repeat(39)}… accepted`));
  assert.match(inviteAnsweredPush("c1", "ev1", "T", "i", "  ").body, /^A coworker accepted/);
});

test("challengeReviewedPush: approved and changes requested, no event id, challenge deep link", () => {
  const approved = challengeReviewedPush("c1", "week1", "week1_alice", true, "Walk 5 times");
  wellFormed(approved);
  assert.equal(approved.title, "Your submission was approved");
  assert.equal(approved.body, "Walk 5 times");
  assert.equal(approved.data.type, "challenge_approved");
  assert.equal(approved.data.deepLink, "dip://challenges/week1");
  assert.equal(approved.data.eventId, undefined);
  assert.equal(approved.category, "challenges");
  const changes = challengeReviewedPush("c1", "week1", "week1_alice", false, "Walk 5 times");
  wellFormed(changes);
  assert.equal(changes.title, "Changes requested on your submission");
  assert.equal(changes.data.type, "challenge_changes_requested");
  assert.doesNotMatch(JSON.stringify(changes), /reason|note/i);
});

test("weeklyThemePush: copy, deep link, category, expiry at the window end", () => {
  const end = new Date("2030-01-07T23:59:59Z");
  const push = weeklyThemePush("c1", "week2", "Hydration Week", end);
  wellFormed(push);
  assert.equal(push.title, "New weekly challenge");
  assert.equal(push.body, "Hydration Week");
  assert.equal(push.data.type, "weekly_theme");
  assert.equal(push.data.deepLink, "dip://challenges/week2");
  assert.equal(push.category, "challenges");
  assert.equal(push.expiresAt, end);
  assert.equal(weeklyThemePush("c1", "week2", "T").expiresAt, undefined);
});

test("requests: recipients are server derived, ids and kinds match the in-app notices, kinds exist in the registry", () => {
  const added = attendeeAddedRequest({ companyId: "c1", eventId: "ev1", eventTitle: "Run", userId: "u1", notificationId: "admin_req-1" });
  assert.deepEqual([added.id, added.kind, added.recipients, added.inApp], ["admin_req-1", "attendee_added", [{ uid: "u1" }], undefined]);
  const answered = inviteAnsweredRequest({ companyId: "c1", eventId: "ev1", eventTitle: "Run", inviteId: "ev1_u2", senderId: "u1", responderName: "Ada" });
  assert.equal(answered.id, "invite_answered_ev1_u2");
  assert.deepEqual(answered.recipients, [{ uid: "u1" }]);
  assert.deepEqual(answered.inApp, { title: "Invitation accepted", body: "Ada accepted your invite to Run.", targetType: "event", targetId: "ev1" });
  const approved = challengeReviewedRequest({ companyId: "c1", challengeId: "w", submissionId: "w_u", userId: "u", challengeTitle: "T", approved: true, notificationId: "challenge_approved_w" });
  const rejected = challengeReviewedRequest({ companyId: "c1", challengeId: "w", submissionId: "w_u", userId: "u", challengeTitle: "T", approved: false, notificationId: "challenge_changes_w_1" });
  assert.deepEqual([approved.kind, approved.id, rejected.kind, rejected.id], ["challenge_approved", "challenge_approved_w", "challenge_changes_requested", "challenge_changes_w_1"]);
  for (const request of [added, answered, approved, rejected]) {
    assert.ok(request.kind in NOTIFICATION_KINDS);
    assert.equal(request.push.category, NOTIFICATION_KINDS[request.kind].category);
    assert.equal(request.push.data.type, request.kind);
  }
});

test("RoutedPushNotifier delivers each kind and swallows delivery failures with a reason code only", async () => {
  const seen: NotificationRequest[] = [];
  const failures: Array<[string, string]> = [];
  const ok = new RoutedPushNotifier(async (request) => { seen.push(request); }, (kind, reason) => failures.push([kind, reason]));
  await ok.attendeeAdded({ companyId: "c", eventId: "e", eventTitle: "T", userId: "u", notificationId: "admin_r" });
  await ok.accepted({ companyId: "c", eventId: "e", eventTitle: "T", inviteId: "e_u", senderId: "s", responderName: "N" });
  await ok.approved({ companyId: "c", challengeId: "w", submissionId: "w_u", userId: "u", challengeTitle: "T", notificationId: "challenge_approved_w" });
  await ok.changesRequested({ companyId: "c", challengeId: "w", submissionId: "w_u", userId: "u", challengeTitle: "T", notificationId: "challenge_changes_w_1" });
  assert.deepEqual(seen.map((r) => r.kind), ["attendee_added", "invite_answered", "challenge_approved", "challenge_changes_requested"]);
  assert.deepEqual(failures, []);

  const broken = new RoutedPushNotifier(async () => { throw new Error("boom Secret Title token-123"); }, (kind, reason) => failures.push([kind, reason]));
  await broken.attendeeAdded({ companyId: "c", eventId: "e", eventTitle: "T", userId: "u", notificationId: "admin_r" });
  await broken.approved({ companyId: "c", challengeId: "w", submissionId: "w_u", userId: "u", challengeTitle: "T", notificationId: "x" });
  assert.deepEqual(failures, [["attendee_added", "Error"], ["challenge_approved", "Error"]]);
  const throwingLogger = new RoutedPushNotifier(async () => { throw new Error("x"); }, () => { throw new Error("logger down"); });
  await throwingLogger.accepted({ companyId: "c", eventId: "e", eventTitle: "T", inviteId: "i", senderId: "s", responderName: "N" });
});

const NOW = new Date("2030-01-07T14:00:00Z");
const theme = (challengeId: string, startHoursAgo: number, over: Partial<WeeklyTheme> = {}): WeeklyTheme => ({
  companyId: "c1", challengeId, title: `Theme ${challengeId}`, startDate: new Date(NOW.getTime() - startHoursAgo * 3_600_000),
  endDate: new Date(NOW.getTime() + 6 * 86_400_000), ...over,
});

test("themesStartedWithin keeps only themes that opened in the last 24 hours and are still open", () => {
  const picked = themesStartedWithin([
    theme("fresh", 5), theme("edge", 24), theme("old", 30), theme("future", -2), theme("ended", 5, { endDate: new Date(NOW.getTime() - 1) }),
    theme("untitled", 5, { title: "  " }), theme("justNow", 0),
  ], NOW);
  assert.deepEqual(picked.map((t) => t.challengeId), ["fresh", "justNow"]);
});

test("weeklyThemeRequest: id, kind, recipients and window expiry", () => {
  const request = weeklyThemeRequest(theme("w9", 3), ["u1", "u2"]);
  assert.equal(request.id, "weekly_theme_c1_w9");
  assert.equal(request.kind, "weekly_theme");
  assert.deepEqual(request.recipients, [{ uid: "u1" }, { uid: "u2" }]);
  assert.equal(request.push.expiresAt?.getTime(), theme("w9", 3).endDate.getTime());
  assert.equal(request.inApp, undefined);
});

function weeklyWorld(themes: WeeklyTheme[], members: Record<string, string[]>) {
  const queries: Array<[Date, Date]> = [];
  const reader: WeeklyThemeReader = { startedBetween: async (from, to) => { queries.push([from, to]); return themes; } };
  const pager: MemberPager = {
    page: async (companyId, after, limit) => {
      const all = members[companyId] ?? [];
      const rest = after ? all.slice(all.indexOf(after) + 1) : all;
      const uids = rest.slice(0, limit);
      return { uids, last: rest.length > limit ? uids[uids.length - 1]! : null };
    },
  };
  const delivered: NotificationRequest[] = [];
  const deliver: Deliver = async (request) => { delivered.push(request); };
  return { reader, pager, delivered, deliver, queries };
}

test("runWeeklyThemePushes sends one request per started theme to that company's members only", async () => {
  const w = weeklyWorld([theme("w1", 4), theme("w0", 40), theme("x1", 2, { companyId: "c2" })], { c1: ["a", "b"], c2: ["z"] });
  const stats = await runWeeklyThemePushes({ themes: w.reader, members: w.pager, deliver: w.deliver, now: () => NOW });
  assert.deepEqual(stats, { themes: 2, delivered: 2, failed: 0 });
  assert.deepEqual(w.delivered.map((r) => [r.id, r.recipients.map((x) => x.uid)]), [["weekly_theme_c1_w1", ["a", "b"]], ["weekly_theme_c2_x1", ["z"]]]);
  assert.equal(w.queries[0]![1].getTime(), NOW.getTime());
  assert.equal(w.queries[0]![0].getTime(), NOW.getTime() - 24 * 3_600_000);
});

test("runWeeklyThemePushes pages members in bounded requests and isolates a failing theme", async () => {
  const many = Array.from({ length: 650 }, (_, i) => `u${String(i).padStart(4, "0")}`);
  const w = weeklyWorld([theme("w1", 4), theme("w2", 3, { companyId: "c2" })], { c1: many, c2: ["z"] });
  const delivered: NotificationRequest[] = [];
  const stats = await runWeeklyThemePushes({
    themes: w.reader, members: w.pager, now: () => NOW,
    deliver: async (request) => { if (request.companyId === "c1" && request.id.endsWith("_p1")) throw new Error("down"); delivered.push(request); },
  });
  assert.deepEqual(delivered.map((r) => r.id), ["weekly_theme_c1_w1", "weekly_theme_c2_w2"]);
  assert.equal(delivered[0]!.recipients.length, 300);
  assert.deepEqual(stats, { themes: 2, delivered: 1, failed: 1 });
  // Full run: ids are per page and every member appears exactly once.
  const all = weeklyWorld([theme("w1", 4)], { c1: many });
  await runWeeklyThemePushes({ themes: all.reader, members: all.pager, deliver: all.deliver, now: () => NOW });
  assert.deepEqual(all.delivered.map((r) => r.id), ["weekly_theme_c1_w1", "weekly_theme_c1_w1_p1", "weekly_theme_c1_w1_p2"]);
  assert.equal(new Set(all.delivered.flatMap((r) => r.recipients.map((x) => x.uid))).size, 650);
});

test("runWeeklyThemePushes sends nothing when no theme started or the company has no members", async () => {
  const none = weeklyWorld([theme("old", 100)], { c1: ["a"] });
  assert.deepEqual(await runWeeklyThemePushes({ themes: none.reader, members: none.pager, deliver: none.deliver, now: () => NOW }), { themes: 0, delivered: 0, failed: 0 });
  const empty = weeklyWorld([theme("w1", 1)], {});
  await runWeeklyThemePushes({ themes: empty.reader, members: empty.pager, deliver: empty.deliver, now: () => NOW });
  assert.equal(empty.delivered.length, 0);
});
