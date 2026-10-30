import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { csvCell } from "../lib/csv";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest } from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 24, 12, 30));
});
afterEach(() => {
  vi.useRealTimers();
});

test("CSV cells can't run as spreadsheet formulas", () => {
  expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  expect(csvCell("-1+2")).toBe("'-1+2");
  expect(csvCell('Tea, "chai"')).toBe('"Tea, ""chai"""');
  expect(csvCell(12)).toBe("12");
});

test("the Admin downloads a report for chosen dates: per meal per day, Yes / No / Not answered", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const admin = await createStaff(t, "admin");
  const a = await createActiveResident(t, "Asha Rao", "101");
  const b = await createActiveResident(t, "Bina Das", "102");
  const services = await t.run(async (ctx) =>
    (await ctx.db.query("mealServices").collect()).filter((s) => s.serviceDate === "2026-10-25"),
  );
  const lunch = services.find((s) => s.mealType === "lunch")!;
  await a.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: lunch._id, selection: "yes" }] });
  await b.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: lunch._id, selection: "no" }] });

  const preview = await admin.as.query(api.reports.summary, { from: "2026-10-25", to: "2026-10-26" });
  expect(preview.days).toBe(2);
  expect(preview.meals.find((m) => m.mealType === "lunch")).toMatchObject({ days: 2, yes: 1, no: 1, unanswered: 2 });

  const { filename, csv } = await admin.as.mutation(api.reports.exportCsv, { from: "2026-10-25", to: "2026-10-25" });
  expect(filename).toBe("dine-test-pg-2026-10-25-to-2026-10-25.csv");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines[0]).toBe("Property,Date,Day,Meal,Status,Residents counted,Yes,No,Not answered,Answered");
  expect(lines).toContain("Test PG,2026-10-25,Sunday,Lunch,Served,2,1,1,0,100%");
  expect(lines).toContain("Test PG,2026-10-25,Sunday,Dinner,Served,2,0,0,2,0%");
  expect(lines).toHaveLength(5);
  const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
  expect(audit.at(-1)).toMatchObject({ action: "report.exported" });

  const range = (from: string, to: string) => errorCode(admin.as.query(api.reports.summary, { from, to }));
  expect(await range("2026-10-26", "2026-10-25")).toBe("INVALID_INPUT");
  expect(await range("2026-01-01", "2026-10-25")).toBe("INVALID_INPUT");
  expect(await range("25/10/2026", "2026-10-25")).toBe("INVALID_INPUT");

  const warden = await createStaff(t, "warden");
  expect(await errorCode(warden.as.query(api.reports.summary, { from: "2026-10-25", to: "2026-10-25" }))).toBe("FORBIDDEN");
  expect(await errorCode(warden.as.mutation(api.reports.exportCsv, { from: "2026-10-25", to: "2026-10-25" }))).toBe("FORBIDDEN");
});

test("the Admin downloads one resident's choices for chosen dates, moved-out residents included", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const admin = await createStaff(t, "admin");
  const a = await createActiveResident(t, "Asha Rao", "101");
  await createActiveResident(t, "Bina Das", "102");
  const services = await t.run(async (ctx) =>
    (await ctx.db.query("mealServices").collect()).filter((s) => s.serviceDate === "2026-10-25"),
  );
  await a.as.mutation(api.meals.saveChoices, {
    choices: [
      { mealServiceId: services.find((s) => s.mealType === "lunch")!._id, selection: "yes" },
      { mealServiceId: services.find((s) => s.mealType === "dinner")!._id, selection: "no" },
    ],
  });
  // Her last day is the 25th; the next day she isn't counted.
  await t.run((ctx) => ctx.db.patch(a.residentId, { validUntil: "2026-10-25", status: "inactive" }));

  const people = await admin.as.query(api.reports.residents, {});
  expect(people.map((p) => [p.displayName, p.movedOut])).toEqual([
    ["Bina Das", false],
    ["Asha Rao", true],
  ]);

  const preview = await admin.as.query(api.reports.summary, { from: "2026-10-25", to: "2026-10-26", residentId: a.residentId });
  expect(preview.meals.find((m) => m.mealType === "lunch")).toMatchObject({ days: 1, yes: 1, no: 0, unanswered: 0 });
  expect(preview.meals.find((m) => m.mealType === "breakfast")).toMatchObject({ days: 1, yes: 0, no: 0, unanswered: 1 });

  const { filename, csv } = await admin.as.mutation(api.reports.exportCsv, {
    from: "2026-10-25",
    to: "2026-10-26",
    residentId: a.residentId,
  });
  expect(filename).toBe("dine-asha-rao-2026-10-25-to-2026-10-26.csv");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines[0]).toBe("Resident,Room,Property,Date,Day,Meal,Choice,Last saved");
  expect(lines).toContain("Asha Rao,101,Test PG,2026-10-25,Sunday,Breakfast,Not answered,");
  expect(lines).toContain("Asha Rao,101,Test PG,2026-10-25,Sunday,Dinner,No,2026-10-24 18:00");
  expect(lines).toContain("Asha Rao,101,Test PG,2026-10-26,Monday,Lunch,Not living here,");
  expect(lines).toHaveLength(9);
  const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
  expect(audit.at(-1)).toMatchObject({ action: "report.exported", entityType: "residents" });

  const warden = await createStaff(t, "warden");
  expect(await errorCode(warden.as.query(api.reports.residents, {}))).toBe("FORBIDDEN");
  expect(
    await errorCode(warden.as.mutation(api.reports.exportCsv, { from: "2026-10-25", to: "2026-10-25", residentId: a.residentId })),
  ).toBe("FORBIDDEN");
});
