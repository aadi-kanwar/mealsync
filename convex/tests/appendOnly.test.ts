import { expect, test } from "vitest";
import { guardedDb } from "../lib/functions";
import { createActiveResident, createProperty, setupTest } from "./harness.test-utils";

test("activity log and audit log entries can be added but never edited or deleted", async () => {
  const t = await setupTest();
  const property = await createProperty(t);
  const resident = await createActiveResident(t);

  await t.run(async (ctx) => {
    const db = guardedDb(ctx);
    const slot = (await ctx.db.query("mealSlots").first())!;
    const serviceId = await db.insert("mealServices", {
      organizationId: property.organizationId,
      propertyId: property._id,
      serviceDate: "2026-11-03",
      mealType: "breakfast",
      mealSlotId: slot._id,
      serviceTime: "08:00",
      cutoffAt: Date.now(),
      status: "scheduled",
      policySnapshot: {
        displayName: "Breakfast",
        serviceTime: "08:00",
        cutoffRule: { daysBefore: 1, time: "21:00" },
        timezone: "Asia/Kolkata",
      },
      createdAt: Date.now(),
    });
    // Inserting is allowed.
    const logId = await db.insert("mealActivityLog", {
      organizationId: property.organizationId,
      propertyId: property._id,
      mealServiceId: serviceId,
      residentId: resident.residentId,
      residentName: "Active Resident",
      roomNumber: "201",
      serviceDate: "2026-11-03",
      mealType: "breakfast",
      mealDisplayName: "Breakfast",
      previousSelection: "none",
      newSelection: "yes",
      afterCutoff: false,
      actorUserId: resident.userId,
      actorName: "Active Resident",
      actorRole: "resident",
      source: "resident_app",
      responseVersion: 1,
      createdAt: Date.now(),
    });
    const auditId = (await ctx.db.query("auditLogs").first())!._id;

    await expect(db.patch(logId, { newSelection: "no" })).rejects.toThrow();
    await expect(db.delete(logId)).rejects.toThrow();
    const original = (await ctx.db.get(logId))!;
    const { _id, _creationTime, ...fields } = original;
    void _id;
    void _creationTime;
    await expect(db.replace(logId, { ...fields, newSelection: "no" })).rejects.toThrow();
    await expect(db.patch(auditId, { action: "tampered" })).rejects.toThrow();
    await expect(db.delete(auditId)).rejects.toThrow();

    expect((await ctx.db.get(logId))?.newSelection).toBe("yes");
    expect((await ctx.db.get(auditId))?.action).not.toBe("tampered");
  });
});
