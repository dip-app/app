import type { BugCategory, BugDiagnostics, BugReport, BugReportDetail, BugStatus } from "./adminTypes";

export const BUG_CATEGORY_LABEL: Record<BugCategory, string> = {
  bug: "Bug", confusing: "Confusing", looksWrong: "Looks wrong", idea: "Idea", unspecified: "No category",
};
export const BUG_STATUS_LABEL: Record<BugStatus, string> = { new: "New", triaged: "Triaged", resolved: "Resolved" };
export const BUG_STATUSES: readonly BugStatus[] = ["new", "triaged", "resolved"];
export const BUG_CATEGORIES: readonly BugCategory[] = ["bug", "confusing", "looksWrong", "idea", "unspecified"];

const SCREEN_LABEL: Record<string, string> = {
  home: "Home", rewards: "Rewards", myEvents: "My events", profile: "Profile", event: "Event", participants: "Participants", album: "Album", challenge: "Challenge", other: "Other",
};
export const screenLabel = (screen: string) => SCREEN_LABEL[screen] ?? screen;

/** Diagnostics in display order with labels; empty values are left out. */
export function diagnosticRows(d: BugDiagnostics | null): { label: string; value: string }[] {
  if (!d) return [];
  const rows: [string, string | undefined][] = [
    ["App version", d.appVersion ? `${d.appVersion}${d.appBuild ? ` (${d.appBuild})` : ""}` : d.appBuild], ["OS", d.osVersion], ["Device", d.deviceModel], ["Language", d.locale],
    ["Screen", d.screen ? screenLabel(d.screen) : undefined], ["Install", d.installId],
  ];
  return rows.filter((row): row is [string, string] => !!row[1]).map(([label, value]) => ({ label, value }));
}

/** Markdown for pasting into an issue tracker: a title line, the description, then the context an engineer needs. */
export function issueText(detail: BugReportDetail): string {
  const r: BugReport = detail.report;
  const firstLine = r.description.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const title = firstLine ? (firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine) : `${BUG_CATEGORY_LABEL[r.category]} report from the app`;
  const lines = [`## ${title}`, "", r.description.trim() || "(No description.)", "", "**Context**", `- Category: ${BUG_CATEGORY_LABEL[r.category]}`, `- Screen: ${screenLabel(r.screen)}`];
  for (const row of diagnosticRows(detail.diagnostics)) if (row.label !== "Screen" && row.label !== "Install") lines.push(`- ${row.label}: ${row.value}`);
  lines.push(`- Reported: ${r.createdAt.slice(0, 16).replace("T", " ")} UTC via ${r.source === "shake" ? "shake" : "Profile"}`, `- Report ID: ${r.id}`);
  if (detail.note.trim()) lines.push("", "**Internal note**", detail.note.trim());
  return `${lines.join("\n")}\n`;
}
