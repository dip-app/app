/**
 * Write-time markers resolved by the infrastructure adapter, so domain/application code never imports the
 * Firestore SDK: a server timestamp, an atomic increment and a field deletion.
 */
export interface ServerTime { readonly __op: "serverTime" }
export interface Increment { readonly __op: "increment"; readonly by: number }
export interface DeleteField { readonly __op: "deleteField" }

export const SERVER_TIME: ServerTime = { __op: "serverTime" };
export const increment = (by: number): Increment => ({ __op: "increment", by });
export const DELETE_FIELD: DeleteField = { __op: "deleteField" };

/** Path builders for every document the admin commands touch (docs/contracts/data-ownership.md). */
export const paths = {
  user: (uid: string) => `users/${uid}`,
  company: (companyId: string) => `companies/${companyId}`,
  events: (companyId: string) => `companies/${companyId}/events`,
  event: (companyId: string, eventId: string) => `companies/${companyId}/events/${eventId}`,
  rsvp: (companyId: string, eventId: string, uid: string) => `companies/${companyId}/events/${eventId}/rsvps/${uid}`,
  photo: (companyId: string, eventId: string, photoId: string) => `companies/${companyId}/events/${eventId}/photos/${photoId}`,
  comments: (companyId: string, eventId: string, photoId: string) => `companies/${companyId}/events/${eventId}/photos/${photoId}/comments`,
  comment: (companyId: string, eventId: string, photoId: string, commentId: string) =>
    `companies/${companyId}/events/${eventId}/photos/${photoId}/comments/${commentId}`,
  receipt: (companyId: string, uid: string, requestId: string) => `companies/${companyId}/commandReceipts/admin_${uid}_${requestId}`,
  audit: (companyId: string, auditId: string) => `companies/${companyId}/auditLog/${auditId}`,
  teams: (companyId: string) => `companies/${companyId}/teams`,
  team: (companyId: string, teamId: string) => `companies/${companyId}/teams/${teamId}`,
  roster: (companyId: string) => `companies/${companyId}/roster`,
  rosterEntry: (companyId: string, emailHash: string) => `companies/${companyId}/roster/${emailHash}`,
  importJob: (companyId: string, jobId: string) => `companies/${companyId}/importJobs/${jobId}`,
  importResult: (companyId: string, jobId: string, rowNumber: number) => `companies/${companyId}/importJobs/${jobId}/results/${rowNumber}`,
  importChunk: (companyId: string, jobId: string, index: number) => `companies/${companyId}/importJobs/${jobId}/chunks/${index}`,
  pointTransaction: (companyId: string, id: string) => `companies/${companyId}/pointTransactions/${id}`,
  insightsSummary: (companyId: string) => `companies/${companyId}/insights/summary`,
  challenges: (companyId: string) => `companies/${companyId}/challenges`,
  submissions: (companyId: string, challengeId: string) => `companies/${companyId}/challenges/${challengeId}/submissions`,
  pointTransactions: (companyId: string) => `companies/${companyId}/pointTransactions`,
  rsvps: (companyId: string, eventId: string) => `companies/${companyId}/events/${eventId}/rsvps`,
  notification: (uid: string, id: string) => `users/${uid}/notifications/${id}`,
};
