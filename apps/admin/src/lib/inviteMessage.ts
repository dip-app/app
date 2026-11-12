/** Mock-mode twin of the server's invite message (gcp/functions .../domain/rosterView.ts `inviteMessage`). */
export const MAX_RESENDS = 10;

export function inviteMessage(input: { name: string; company: string; email: string; role: string }): { signInUrl: string; message: string } {
  const staff = input.role === "admin" || input.role === "organizer";
  const signInUrl = staff ? "https://letsdip.work/admin/" : "https://letsdip.work";
  const first = input.name.trim().split(/\s+/)[0] ?? "";
  const where = staff ? `the DIP admin portal (${signInUrl})` : `the DIP app (${signInUrl})`;
  const message = [
    `${first ? `Hi ${first}, y` : "Y"}ou're set up on DIP at ${input.company || "your company"}.`,
    `Open ${where} and sign in with Google using ${input.email}.`,
    staff ? "Your role is already assigned." : "Your teams and details are already filled in.",
  ].join(" ");
  return { signInUrl, message };
}
