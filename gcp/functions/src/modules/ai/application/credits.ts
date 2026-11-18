import type { AdminTransaction, Doc } from "../../admin/application/ports";
import { ledgerBase, ledgerFromDoc, type CreditLedger, type LedgerBase } from "../domain/credits";
import { aiPaths } from "../domain/paths";

export interface LoadedLedger { ledger: CreditLedger; base: LedgerBase; path: string; doc: Doc | null }

/**
 * Reads the company's credit ledger for the period `now` falls in. The period depends on the company's time zone, so
 * the time zone document is read first and the ledger document second (both inside the caller's transaction).
 */
export async function loadLedger(tx: AdminTransaction, companyId: string, companySettings: Doc | null, now: Date): Promise<LoadedLedger> {
  const base = ledgerBase(companySettings, await tx.get(aiPaths.emailSettings(companyId)), now);
  const path = aiPaths.credits(companyId, base.period);
  const doc = await tx.get(path);
  return { ledger: ledgerFromDoc(base, doc), base, path, doc };
}
