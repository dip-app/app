import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { serverTimestamp, Timestamp, deleteDoc, doc, getDoc, getDocs, collection, collectionGroup, setDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

let environment: RulesTestEnvironment;
const REPORT = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
const INSTALL = "0a1b2c3d-1111-2222-3333-444455556666";
const member = (uid = "member", verified = true) => environment.authenticatedContext(uid, { email_verified: verified });
const reportDoc = (ctx: ReturnType<typeof member>, id = REPORT) => doc(ctx.firestore(), `bugReports/${id}`);
const diagnostics = {
  appVersion: "2.0", appBuild: "412", osVersion: "iOS 18.1", deviceModel: "iPhone17,1", locale: "en_US",
  screen: "event", installId: INSTALL,
};
const valid = (uid = "member", extra: Record<string, unknown> = {}) => ({
  uid, category: "bug", description: "Tapped Join but the button kept spinning", source: "shake", screen: "event",
  diagnostics, createdAt: serverTimestamp(), ...extra,
});
const withScreenshot = (uid = "member", id = REPORT) => valid(uid, {
  screenshotPath: `bugReports/${uid}/${id}.jpg`, screenshotBytes: 120_000,
});
const jpeg = (bytes: number) => new Uint8Array(bytes).fill(7);

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-dip",
    firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") },
    storage: { host: "127.0.0.1", port: 9199, rules: readFileSync("gcp/storage.rules", "utf8") },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    // Server-owned membership documents; "stranger" has none.
    for (const uid of ["member", "other"]) {
      await store.doc(`users/${uid}`).set({ companyId: "company-a", role: "member", displayName: "Test Member", createdAt: Timestamp.now() });
    }
  });
});
after(async () => { await environment?.cleanup(); });

test("a verified member creates a valid report, with and without diagnostics or screenshot", async () => {
  await assertSucceeds(setDoc(reportDoc(member()), valid()));
  const noDiagnostics = { ...valid() } as Record<string, unknown>;
  delete noDiagnostics.diagnostics;
  await assertSucceeds(setDoc(reportDoc(member(), "11111111-1111-4111-8111-111111111111"), noDiagnostics));
  await assertSucceeds(setDoc(reportDoc(member(), "22222222-2222-4222-8222-222222222222"),
    withScreenshot("member", "22222222-2222-4222-8222-222222222222")));
});

test("category-less reports need a real description", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  await assertFails(setDoc(reportDoc(member(), id), valid("member", { category: "unspecified", description: "too short" })));
  await assertFails(setDoc(reportDoc(member(), id), valid("member", { category: "unspecified", description: "          " })));
  await assertSucceeds(setDoc(reportDoc(member(), id), valid("member", { category: "unspecified", description: "long enough text" })));
});

test("auth denial: anonymous, unverified and non-members cannot create", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), `bugReports/${id}`), valid()));
  await assertFails(setDoc(reportDoc(member("member", false), id), valid()));
  await assertFails(setDoc(reportDoc(member("stranger"), id), valid("stranger")));
});

test("field ownership: uid must equal the caller; paths must be the caller's own", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  await assertFails(setDoc(reportDoc(member(), id), valid("other")));
  const noUid = { ...valid() } as Record<string, unknown>;
  delete noUid.uid;
  await assertFails(setDoc(reportDoc(member(), id), noUid));
  await assertFails(setDoc(reportDoc(member(), id), valid("member", {
    screenshotPath: `bugReports/other/${id}.jpg`, screenshotBytes: 1000 })));
  await assertFails(setDoc(reportDoc(member(), id), valid("member", {
    screenshotPath: `bugReports/member/not-this-report.jpg`, screenshotBytes: 1000 })));
});

test("client cannot set server-owned or unknown fields", async () => {
  const id = "66666666-6666-4666-8666-666666666666";
  for (const extra of [{ companyId: "company-a" }, { email: "a@b.test" }, { status: "triaged" }, { role: "admin" }, { token: "x" }]) {
    await assertFails(setDoc(reportDoc(member(), id), valid("member", extra)));
  }
  await assertFails(setDoc(reportDoc(member(), id), valid("member", { diagnostics: { ...diagnostics, email: "a@b.test" } })));
  const missing = { ...diagnostics } as Record<string, unknown>;
  delete missing.installId;
  await assertFails(setDoc(reportDoc(member(), id), valid("member", { diagnostics: missing })));
});

test("size and shape limits", async () => {
  const id = "77777777-7777-4777-8777-777777777777";
  await assertSucceeds(setDoc(reportDoc(member(), id), valid("member", { description: "a".repeat(1000) })));
  const over = "88888888-8888-4888-8888-888888888888";
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { description: "a".repeat(1001) })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { category: "nope" })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { source: "web" })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { screen: "event/puppy-yoga-123" })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { diagnostics: { ...diagnostics, deviceModel: "x".repeat(41) } })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { diagnostics: { ...diagnostics, installId: "not-a-uuid" } })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", {
    screenshotPath: `bugReports/member/${over}.jpg`, screenshotBytes: 409601 })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { screenshotPath: `bugReports/member/${over}.jpg` })));
  await assertFails(setDoc(reportDoc(member(), over), valid("member", { screenshotBytes: 1000 })));
});

test("the description limit counts UTF-16 units (the client trims to match)", async () => {
  await assertSucceeds(setDoc(reportDoc(member(), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    valid("member", { description: "😀".repeat(500) })));
  await assertSucceeds(setDoc(reportDoc(member(), "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    valid("member", { description: "é".repeat(1000) })));
  await assertFails(setDoc(reportDoc(member(), "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    valid("member", { description: "😀".repeat(501) })));
});

test("createdAt must be the server time and the document id must be a UUID", async () => {
  const id = "99999999-9999-4999-8999-999999999999";
  await assertFails(setDoc(reportDoc(member(), id), valid("member", { createdAt: Timestamp.fromMillis(1000) })));
  await assertFails(setDoc(reportDoc(member(), "not-a-uuid"), valid()));
  await assertFails(setDoc(reportDoc(member(), "6F9619FF-8B86-D011-B42D-00C04FC964FF"), valid()), "uppercase id");
});

test("create-only: no read, list, update, overwrite or delete, by anyone", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await assertSucceeds(setDoc(reportDoc(member(), id), valid()));
  await assertFails(setDoc(reportDoc(member(), id), valid()), "repeat create is an update");
  await assertFails(updateDoc(reportDoc(member(), id), { description: "edited after the fact" }));
  await assertFails(getDoc(reportDoc(member(), id)));
  await assertFails(getDocs(collection(member().firestore(), "bugReports")));
  await assertFails(deleteDoc(reportDoc(member(), id)));
  await assertFails(getDoc(reportDoc(member("other"), id)));
  await assertFails(getDoc(reportDoc(environment.unauthenticatedContext(), id)));
  const admin = environment.authenticatedContext("admin", { email_verified: true });
  await assertFails(getDoc(reportDoc(admin, id)));
});

test("storage: owner uploads a small JPEG to their own path only", async () => {
  const path = `bugReports/member/${REPORT}.jpg`;
  const own = member().storage();
  await assertSucceeds(uploadBytes(ref(own, path), jpeg(300_000), { contentType: "image/jpeg" }));
  await assertSucceeds(uploadBytes(ref(own, path), jpeg(200_000), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(member("other").storage(), path), jpeg(1000), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(environment.unauthenticatedContext().storage(), path), jpeg(1000), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(member("member", false).storage(), path), jpeg(1000), { contentType: "image/jpeg" }));
});

test("storage: verified non-members cannot upload", async () => {
  await assertFails(uploadBytes(ref(member("stranger").storage(), `bugReports/stranger/${REPORT}.jpg`), jpeg(1000), { contentType: "image/jpeg" }));
});

test("storage: size, type and path limits", async () => {
  const own = member().storage();
  await assertFails(uploadBytes(ref(own, `bugReports/member/${REPORT}.jpg`), jpeg(400 * 1024 + 1), { contentType: "image/jpeg" }));
  await assertSucceeds(uploadBytes(ref(own, `bugReports/member/${REPORT}.jpg`), jpeg(400 * 1024), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(own, `bugReports/member/${REPORT}.jpg`), jpeg(1000), { contentType: "image/png" }));
  await assertFails(uploadBytes(ref(own, `bugReports/member/${REPORT}.png`), jpeg(1000), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(own, "bugReports/member/notes.jpg"), jpeg(1000), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(own, `bugReports/member/sub/${REPORT}.jpg`), jpeg(1000), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(own, `bugReports/${REPORT}.jpg`), jpeg(1000), { contentType: "image/jpeg" }));
});

test("storage: no client reads or deletes, even for the owner", async () => {
  const path = `bugReports/member/${REPORT}.jpg`;
  const own = member().storage();
  await assertSucceeds(uploadBytes(ref(own, path), jpeg(1000), { contentType: "image/jpeg" }));
  await assertFails(getBytes(ref(own, path)));
  await assertFails(deleteObject(ref(own, path)));
  await assertFails(getBytes(ref(member("other").storage(), path)));
});

test("triage documents are server-only: no client read or write, admins and the reporter included", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("users/boss").set({ companyId: "company-a", role: "admin", displayName: "Boss", createdAt: Timestamp.now() });
    await context.firestore().doc(`companies/company-a/bugReportTriage/${REPORT}`).set({ companyId: "company-a", reportId: REPORT, status: "triaged", note: "internal" });
  });
  const path = `companies/company-a/bugReportTriage/${REPORT}`;
  for (const ctx of [member(), member("other"), environment.authenticatedContext("boss", { email_verified: true }), environment.unauthenticatedContext()]) {
    await assertFails(getDoc(doc(ctx.firestore(), path)));
    await assertFails(getDocs(collection(ctx.firestore(), "companies/company-a/bugReportTriage")));
    await assertFails(getDocs(collectionGroup(ctx.firestore(), "bugReportTriage")));
    await assertFails(setDoc(doc(ctx.firestore(), path), { companyId: "company-a", reportId: REPORT, status: "resolved", note: "" }));
    await assertFails(updateDoc(doc(ctx.firestore(), path), { status: "resolved" }));
    await assertFails(deleteDoc(doc(ctx.firestore(), path)));
  }
});
