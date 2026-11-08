export type Document = Record<string, unknown>;
export interface ParticipationTransaction {
  getMember(uid: string): Promise<Document | null>;
  getEvent(companyId: string, eventId: string): Promise<Document | null>;
  getRsvp(companyId: string, eventId: string, uid: string): Promise<Document | null>;
  createRsvp(companyId: string, eventId: string, uid: string, data: Document): void;
  updateRsvp(companyId: string, eventId: string, uid: string, data: Document): void;
  setCount(companyId: string, eventId: string, count: number): void;
}
export interface ParticipationStore {
  runTransaction<T>(work: (tx: ParticipationTransaction) => Promise<T>): Promise<T>;
}
export interface ParticipationIdentity {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}
