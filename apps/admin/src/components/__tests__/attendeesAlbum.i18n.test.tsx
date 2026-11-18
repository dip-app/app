// @vitest-environment jsdom
// Spanish for the event attendees and album pages: plurals, slots and the English path.
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";

afterEach(() => setLocale("en"));

describe("attendees (Spanish)", () => {
  it("translates labels, toasts and plurals", () => {
    setLocale("es");
    expect(t("attendees.going", { count: 3, capacity: 10 })).toBe("3 de 10 van");
    expect(t("attendees.count.total", { count: 1 })).toBe("1 asistente");
    expect(t("attendees.count.total", { count: 4 })).toBe("4 asistentes");
    expect(t("attendees.toast.exported", { count: 2 })).toBe("Se exportaron 2 asistentes.");
    expect(t("attendees.addDialog.title", { name: "Nico Farrow" })).toBe("¿Agregar a Nico Farrow?");
    expect(t("attendees.action.checkInFor", { name: "Nico Farrow" })).toBe("Registrar llegada de Nico Farrow");
    expect(t("attendees.toast.pointsAwarded", { count: 5 })).toBe("Se otorgaron 5 puntos.");
  });

  it("keeps English unchanged", () => {
    expect(t("attendees.going", { count: 3, capacity: 10 })).toBe("3 of 10 going");
    expect(t("attendees.count.total", { count: 1 })).toBe("1 attendee");
    expect(t("attendees.toast.exported", { count: 2 })).toBe("Exported 2 attendees.");
    expect(t("attendees.toast.checkedIn", { name: "Nico Farrow" })).toBe("Nico Farrow: checked in.");
    expect(t("attendees.toast.pointsAwarded", { count: 5 })).toBe("5 points awarded.");
    expect(t("attendees.addDialog.full", { capacity: 12 })).toBe("The event is full (12 places). Adding them raises the capacity by one and needs a reason.");
  });
});

describe("album (Spanish)", () => {
  it("translates counts and the photo tile label", () => {
    setLocale("es");
    expect(t("album.count.photos", { count: 1 })).toBe("1 foto");
    expect(t("album.count.comments", { count: 3 })).toBe("3 comentarios");
    expect(t("album.tile.label", { name: "Ana", date: "9 nov, 3:05 p.m.", count: 1 })).toBe("Ana, 9 nov, 3:05 p.m., 1 comentario: abrir foto");
    expect(t("album.remove.commentBody", { name: "Ana" })).toContain("El comentario de Ana");
  });

  it("keeps English unchanged", () => {
    expect(t("album.count.photos", { count: 1 })).toBe("1 photo");
    expect(t("album.tile.label", { name: "Ana", date: "Nov 9, 3:05 PM", count: 2 })).toBe("Ana, Nov 9, 3:05 PM, 2 comments: open photo");
    expect(t("album.viewer.comments", { count: 4 })).toBe("Comments (4)");
  });
});
