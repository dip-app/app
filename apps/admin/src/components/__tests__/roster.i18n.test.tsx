// @vitest-environment jsdom
// Spanish for the roster page: plurals, slots and the English path.
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";

afterEach(() => setLocale("en"));

describe("roster (Spanish)", () => {
  it("translates labels and pluralizes counts", () => {
    setLocale("es");
    expect(t("members.invited.section", { count: 2 })).toBe("2 personas invitadas aún no se unen");
    expect(t("roster.state.revoked")).toBe("Revocado");
    expect(t("roster.unlisted.headline", { count: 1 })).toBe("1 miembro aún no está en la lista de personal.");
    expect(t("roster.unlisted.headline", { count: 3 })).toContain("3 miembros aún no están");
    expect(t("roster.count.showingOf", { shown: "20", total: 1 })).toBe("Mostrando 20 de 1 persona");
    expect(t("roster.count.matches", { count: 5 })).toBe("5 personas coinciden");
    expect(t("roster.backfill.confirm", { count: 2 })).toBe("Agregar 2 personas");
    expect(t("roster.toast.added", { count: 1 })).toBe("Se agregó 1 persona a la lista de personal.");
  });

  it("fills slots", () => {
    setLocale("es");
    expect(t("roster.revoke.title", { name: "Ada" })).toBe("¿Revocar la invitación de Ada?");
    expect(t("roster.table.resentLast", { count: 2, date: "9 nov 2026" })).toBe("Mensaje compartido 2×, último 9 nov 2026");
    expect(t("roster.message.intro", { email: "a@x.co" })).toContain("a@x.co");
  });

  it("keeps English unchanged", () => {
    expect(t("roster.unlisted.headline", { count: 1 })).toBe("1 member isn’t on the company list yet.");
    expect(t("roster.unlisted.headline", { count: 1234 })).toBe("1,234 members aren’t on the company list yet.");
    expect(t("roster.count.showingOf", { shown: "20", total: 1234 })).toBe("Showing 20 of 1,234 people");
    expect(t("roster.count.matches", { count: 1 })).toBe("1 person matches");
    expect(t("roster.backfill.confirm", { count: 1 })).toBe("Add 1 person");
    expect(t("roster.revoke.title", { name: "Ada" })).toBe("Revoke Ada’s invite?");
    expect(t("roster.table.resent", { count: 3 })).toBe("Message shared 3×");
    expect(t("roster.add.emailHint", { domain: "acme.com" })).toBe("Must end in @acme.com.");
    expect(t("roster.message.recorded", { count: 2 })).toBe("Message shared 2× so far.");
  });
});
