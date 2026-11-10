import type { ReminderWindow } from "./push";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The scheduler runs every 15 minutes. A reminder is due while the time until start lies in its window:
 * - "24h": (20 h, 24 h] — first run sends it ~24 h ahead; a scheduler outage of up to 4 h is tolerated.
 * - "1h":  (0, 60 min] — first run sends it 45–60 min ahead.
 * Events that start within 20 h of being created (or of an outage) get only the 1 h reminder.
 * Exactly-once is enforced by a per-event, per-window, per-startTime receipt, not by these windows.
 */
export const REMINDER_WINDOWS: Readonly<Record<ReminderWindow, { fromMs: number; toMs: number }>> = {
  "24h": { fromMs: 20 * HOUR, toMs: 24 * HOUR },
  "1h": { fromMs: 0, toMs: HOUR },
};

export const REMINDER_SCHEDULE = "every 15 minutes";

export function dueWindow(startTime: Date, now: Date): ReminderWindow | null {
  const lead = startTime.getTime() - now.getTime();
  for (const window of ["1h", "24h"] as const) {
    const { fromMs, toMs } = REMINDER_WINDOWS[window];
    if (lead > fromMs && lead <= toMs) return window;
  }
  return null;
}

/** Receipt key: a time change (only possible before anyone RSVPs) yields a fresh reminder for the new start. */
export function reminderKey(window: ReminderWindow, startTime: Date): string {
  return `reminder_${window}_${startTime.getTime()}`;
}
