// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ImportPlanRequest, ImportPlanResponse, PlanAction } from "@/lib/adminTypes";
import { AddPersonDialog } from "../AddPersonDialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});
afterEach(cleanup);

function api(action: PlanAction) {
  const planImport = vi.fn(async (request: ImportPlanRequest): Promise<ImportPlanResponse> => ({
    jobId: "job-1", planHash: "h", chunkCount: 1,
    rows: request.rows.map((row, i) => ({ rowNumber: i + 1, email: row.email, action, target: "roster", changes: [], errors: action === "invalid" ? [{ code: "x", message: "That email belongs to another company." }] : [] })),
  }));
  const applyImportStep = vi.fn(async () => ({ status: "completed" as const, done: true, progress: { processed: 1, total: 1, created: 1, updated: 0, unchanged: 0, failed: 0 }, results: [] }));
  return { planImport, applyImportStep };
}

function fill(name: string, email: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
}

describe("AddPersonDialog", () => {
  it("adds one person through the import's dry run and apply, with the chosen role", async () => {
    const fake = api("create");
    const onAdded = vi.fn();
    render(<AddPersonDialog api={fake} domain="acme.com" onAdded={onAdded} onClose={() => {}} />);
    expect(screen.getByText("Must end in @acme.com.")).toBeTruthy();
    fill("Jordan Lee", " Jordan.Lee@acme.com ");
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "organizer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith("Jordan Lee"));
    expect(fake.planImport.mock.calls[0][0].rows).toEqual([expect.objectContaining({ email: "jordan.lee@acme.com", displayName: "Jordan Lee", role: "organizer" })]);
    expect(fake.applyImportStep).toHaveBeenCalledWith("job-1", "h");
  });

  it("checks the name and the company domain before calling the server", async () => {
    const fake = api("create");
    render(<AddPersonDialog api={fake} domain="acme.com" onAdded={() => {}} onClose={() => {}} />);
    fill("", "jordan.lee@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(screen.getByText("Check the details above.")).toBeTruthy());
    expect(screen.getByText("Add their name.")).toBeTruthy();
    expect(screen.getByLabelText("Work email").getAttribute("aria-invalid")).toBe("true");
    expect(fake.planImport).not.toHaveBeenCalled();
  });

  it("never applies a row that would update someone already on the roster", async () => {
    const fake = api("update");
    const onAdded = vi.fn();
    render(<AddPersonDialog api={fake} domain="acme.com" onAdded={onAdded} onClose={() => {}} />);
    fill("Nico Farrow", "nico.farrow@acme.com");
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(screen.getByText(/That email is already on the roster/)).toBeTruthy());
    expect(fake.applyImportStep).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("shows the server's reason under the email when the dry run rejects the row", async () => {
    const fake = api("invalid");
    render(<AddPersonDialog api={fake} domain="acme.com" onAdded={() => {}} onClose={() => {}} />);
    fill("Sam Rivera", "sam.rivera@acme.com");
    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(screen.getByText("That email belongs to another company.")).toBeTruthy());
    expect(fake.applyImportStep).not.toHaveBeenCalled();
  });
});
