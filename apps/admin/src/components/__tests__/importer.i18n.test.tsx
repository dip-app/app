// @vitest-environment jsdom
// Spanish for the people importer: the column-matching step renders in Spanish and English is unchanged.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { type RawFile, fieldLabel, validateRow } from "@/lib/importFile";
import { mappingIssues } from "@/lib/importMapping";
import { ImportMapping } from "../ImportMapping";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const raw: RawFile = {
  fileName: "people.csv",
  sheets: [{ name: "Sheet1", rows: [["Email", "Name"], ["sam@acme.com", "Sam"]] }],
};
const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function mapping() {
  return render(<ImportMapping raw={raw} domain="acme.com" companyId="acme" store={store} onBack={() => {}} onContinue={() => {}} />);
}

describe("importer (Spanish)", () => {
  it("renders the matching step in Spanish", () => {
    setLocale("es");
    mapping();
    expect(screen.getByRole("heading", { name: "2. Asocia tus columnas" })).toBeTruthy();
    expect(screen.getByText(/dinos qué contiene cada columna/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revisar las filas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Elegir otro archivo" })).toBeTruthy();
    expect(screen.getByText("1 fila encontrada")).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "Correo (obligatorio)" }).length).toBeGreaterThan(0);
  });

  it("pluralizes and keeps the user's file name", () => {
    setLocale("es");
    expect(t("import.apply", { count: 1 })).toBe("Aplicar 1 cambio");
    expect(t("import.apply", { count: 1200 })).toBe("Aplicar 1200 cambios");
    expect(t("import.confirm.added", { create: 1, update: 2 })).toBe("Se agrega 1 persona nueva a la lista de personal y se actualizan 2 registros existentes.");
    expect(fieldLabel("startDate")).toBe("Fecha de inicio");
    expect(fieldLabel("somethingElse")).toBe("somethingElse");
  });
});

describe("importer validation (Spanish)", () => {
  it("translates row, mapping and file messages", () => {
    const row = { email: "nope", displayName: "", role: "", teams: [], department: "", jobTitle: "", workLocation: "", managerEmail: "", startDate: "" } as const;
    setLocale("es");
    expect(validateRow({ ...row, teams: [] }, "acme.com")).toEqual(["El correo no es válido."]);
    expect(mappingIssues(["skip"]).errors).toEqual(["Elige qué columna contiene correo. Es obligatorio."]);
    setLocale("en");
    expect(validateRow({ ...row, teams: [] }, "acme.com")).toEqual(["Email isn’t valid."]);
    expect(mappingIssues(["skip"]).errors).toEqual(["Choose which column holds email. It is required."]);
  });
});

describe("importer (English)", () => {
  it("keeps the English wording", () => {
    mapping();
    expect(screen.getByRole("heading", { name: "2. Match your columns" })).toBeTruthy();
    expect(screen.getByText("holds. We guessed from the headers; change anything that’s off. Email is required.", { exact: false })).toBeTruthy();
    expect(screen.getByText("1 row found")).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "Email (required)" }).length).toBeGreaterThan(0);
    expect(t("import.apply", { count: 1200 })).toBe("Apply 1200 changes");
    expect(t("import.confirm.added", { create: 1, update: 2 })).toBe("1 new person is added to the roster and 2 existing records are updated.");
    expect(t("import.checking.rows", { count: 1 })).toBe("Checking 1 row. Nothing is saved yet.");
  });
});
