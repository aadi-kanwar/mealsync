import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest } from "./harness.test-utils";

test("the Admin renames the organisation and PG; audited; others can't", async () => {
  const t = await setupTest();
  await createProperty(t);
  const admin = await createStaff(t, "admin");
  expect(await admin.as.query(api.settings.get, {})).toMatchObject({ organizationName: "Test Org", propertyName: "Test PG" });
  await admin.as.mutation(api.settings.update, { organizationName: " Sunrise  Stays ", propertyName: "Sunrise PG, Koramangala" });
  expect(await admin.as.query(api.settings.get, {})).toMatchObject({
    organizationName: "Sunrise Stays",
    propertyName: "Sunrise PG, Koramangala",
  });
  expect((await admin.as.query(api.users.me, {}))?.property?.name).toBe("Sunrise PG, Koramangala");
  expect(await errorCode(admin.as.mutation(api.settings.update, { organizationName: "A", propertyName: "Fine name" }))).toBe(
    "INVALID_INPUT",
  );
  const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
  expect(audit.at(-1)).toMatchObject({ action: "settings.updated" });

  const warden = await createStaff(t, "warden");
  const resident = await createActiveResident(t);
  for (const as of [warden.as, resident.as]) {
    expect(await errorCode(as.query(api.settings.get, {}))).toBe("FORBIDDEN");
    expect(await errorCode(as.mutation(api.settings.update, { organizationName: "Xx", propertyName: "Yy" }))).toBe("FORBIDDEN");
  }
});
