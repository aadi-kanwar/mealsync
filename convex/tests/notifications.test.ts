import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { dueReminder } from "../notifications";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest, type T } from "./harness.test-utils";

// Tue 27 Oct 2026, 21:02 IST: today's meals are closed, tomorrow's are open until 6 AM.
const AT_9PM = Date.UTC(2026, 9, 27, 15, 32);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT_9PM);
});
afterEach(() => {
  vi.useRealTimers();
});

const device = (n: number) => ({ endpoint: `https://push.example.com/send/${n}`, p256dh: "p".repeat(87), auth: "a".repeat(22) });

async function answerAll(t: T, as: Awaited<ReturnType<typeof createActiveResident>>["as"], date: string) {
  const services = await t.run(async (ctx) =>
    (await ctx.db.query("mealServices").collect()).filter((s) => s.serviceDate === date),
  );
  await as.mutation(api.meals.saveChoices, {
    choices: services.map((s) => ({ mealServiceId: s._id, selection: "no" as const })),
  });
}

test("a reminder time is due for 30 minutes, across midnight too", () => {
  expect(dueReminder(["21:00", "05:00"], "20:59")).toBeNull();
  expect(dueReminder(["21:00", "05:00"], "21:00")).toBe("21:00");
  expect(dueReminder(["21:00", "05:00"], "21:29")).toBe("21:00");
  expect(dueReminder(["21:00", "05:00"], "21:30")).toBeNull();
  expect(dueReminder(["05:00"], "05:10")).toBe("05:00");
  expect(dueReminder(["23:50"], "00:10")).toBe("23:50");
});

test("reminders go once, only to residents with unanswered open meals who turned them on", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const forgetful = await createActiveResident(t, "Forgetful Fred", "101");
  const done = await createActiveResident(t, "Done Dina", "102");
  await createActiveResident(t, "No Phone", "103");
  await forgetful.as.mutation(api.notifications.subscribe, device(1));
  await done.as.mutation(api.notifications.subscribe, device(2));
  await answerAll(t, done.as, "2026-10-28");

  const target = await t.run(async (ctx) => {
    const { reminderTargets } = await import("../notifications");
    const property = (await ctx.db.query("properties").first())!;
    return await reminderTargets(ctx, property, Date.now());
  });
  expect(target?.date).toBe("2026-10-28");
  expect(target?.residents.map((r) => r.displayName).sort()).toEqual(["Forgetful Fred", "No Phone"]);

  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 1 });
  // Already sent for 21:00 today.
  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 0 });
  expect(await t.run((ctx) => ctx.db.query("reminderRuns").collect())).toMatchObject([
    { date: "2026-10-27", time: "21:00", recipients: 1 },
  ]);

  // 5 AM: tomorrow's meals are still open (until 6 AM), so it's "today" now.
  vi.setSystemTime(Date.UTC(2026, 9, 27, 23, 31));
  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 1 });

  // 7 AM: no reminder is due.
  vi.setSystemTime(Date.UTC(2026, 9, 28, 1, 30));
  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 0 });
});

test("the Admin's reminder settings decide when, and whether, reminders go", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const admin = await createStaff(t, "admin");
  const resident = await createActiveResident(t);
  await resident.as.mutation(api.notifications.subscribe, device(1));

  expect((await admin.as.query(api.settings.get, {})).reminders).toEqual({ enabled: true, times: ["21:00", "05:00"] });
  await admin.as.mutation(api.settings.updateReminders, { enabled: true, times: ["22:00", "20:30", "22:00"] });
  expect((await admin.as.query(api.settings.get, {})).reminders).toEqual({ enabled: true, times: ["20:30", "22:00"] });
  // It's 21:02: neither 20:30 (32 minutes ago) nor 22:00 is due.
  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 0 });

  await admin.as.mutation(api.settings.updateReminders, { enabled: false, times: ["21:00"] });
  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 0 });
  await admin.as.mutation(api.settings.updateReminders, { enabled: true, times: ["21:00"] });
  expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 1 });

  const save = (enabled: boolean, times: string[]) =>
    errorCode(admin.as.mutation(api.settings.updateReminders, { enabled, times }));
  expect(await save(true, [])).toBe("INVALID_INPUT");
  expect(await save(true, ["9 PM"])).toBe("INVALID_INPUT");
  expect(await save(true, ["24:00"])).toBe("INVALID_INPUT");
  expect(await save(true, ["01:00", "02:00", "03:00", "04:00", "05:00"])).toBe("INVALID_INPUT");
  const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
  expect(audit.at(-1)).toMatchObject({ action: "settings.reminders_updated" });

  const warden = await createStaff(t, "warden");
  expect(await errorCode(warden.as.mutation(api.settings.updateReminders, { enabled: false, times: [] }))).toBe("FORBIDDEN");
});

test("only approved residents can turn reminders on; each device belongs to one person", async () => {
  const t = await setupTest();
  await createProperty(t);
  const a = await createActiveResident(t, "Asha Rao", "101");
  const b = await createActiveResident(t, "Bina Das", "102");
  const warden = await createStaff(t, "warden");
  expect(await errorCode(warden.as.mutation(api.notifications.subscribe, device(1)))).toBe("FORBIDDEN");
  expect(
    await errorCode(a.as.mutation(api.notifications.subscribe, { ...device(1), endpoint: "http://insecure.example.com" })),
  ).toBe("INVALID_INPUT");

  await a.as.mutation(api.notifications.subscribe, device(1));
  expect(await a.as.query(api.notifications.isSubscribed, { endpoint: device(1).endpoint })).toBe(true);
  // B signs in on the same phone and turns reminders on: it's B's now.
  await b.as.mutation(api.notifications.subscribe, device(1));
  expect(await a.as.query(api.notifications.isSubscribed, { endpoint: device(1).endpoint })).toBe(false);
  // A can't turn off B's reminders.
  await a.as.mutation(api.notifications.unsubscribe, { endpoint: device(1).endpoint });
  expect(await b.as.query(api.notifications.isSubscribed, { endpoint: device(1).endpoint })).toBe(true);
  await b.as.mutation(api.notifications.unsubscribe, { endpoint: device(1).endpoint });
  expect(await t.run((ctx) => ctx.db.query("pushSubscriptions").collect())).toEqual([]);
});
