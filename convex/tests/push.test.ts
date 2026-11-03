import { createECDH, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import https, { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: no types; web-push's own decryption library, used here to read what was sent.
import ece from "http_ece";
import { expect, test } from "vitest";
import webpush from "web-push";
import { internal } from "../_generated/api";
import { createActiveResident, createProperty, setupTest } from "./harness.test-utils";

// In a file of its own: it switches on real sending (the signing keys), which
// must not reach other tests' made-up devices.

test("sending really delivers: the push service gets the signed, encrypted reminder; gone devices are removed", async () => {
  // A stand-in for Google's / Apple's push service, on this machine.
  const received: { path: string; headers: Record<string, unknown>; body: Buffer }[] = [];
  // Push services use https; this one gets a certificate made for the test,
  // and only this test's requests trust it.
  const dir = mkdtempSync(join(tmpdir(), "dine-push-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
  ], { stdio: "ignore" });
  const cert = readFileSync(join(dir, "cert.pem"));
  const previousCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = cert;
  const server = createServer({ key: readFileSync(join(dir, "key.pem")), cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url?.includes("gone") ? 410 : 201;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  try {
    const t = await setupTest();
    await createProperty(t);
    // What a phone's browser creates when reminders are turned on.
    const phone = createECDH("prime256v1");
    phone.generateKeys();
    const authSecret = randomBytes(16);
    const resident = await createActiveResident(t);
    const ids = await t.run(async (ctx) => {
      const property = (await ctx.db.query("properties").first())!;
      const add = (endpoint: string) =>
        ctx.db.insert("pushSubscriptions", {
          organizationId: property.organizationId,
          propertyId: property._id,
          userId: resident.userId,
          endpoint,
          p256dh: phone.getPublicKey("base64url"),
          auth: authSecret.toString("base64url"),
          createdAt: Date.now(),
        });
      return { ok: await add(`https://127.0.0.1:${port}/send/ok`), gone: await add(`https://127.0.0.1:${port}/send/gone`) };
    });
    const devices = await t.run(async (ctx) =>
      (await ctx.db.query("pushSubscriptions").collect()).map((s) => ({
        subscriptionId: s._id,
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
      })),
    );
    const result = await t.action(internal.push.send, {
      devices,
      title: "Sunrise PG",
      body: "Meals for tomorrow close at 6:00 AM.",
      url: "/home",
    });
    expect(result).toEqual({ delivered: 1, removed: 1 });

    const ok = received.find((r) => r.path === "/send/ok")!;
    expect(ok.headers["content-encoding"]).toBe("aes128gcm");
    expect(String(ok.headers.authorization)).toMatch(/^vapid t=.+, k=/);
    // Only the phone can read it: decrypt with the phone's private key.
    const plain = ece.decrypt(ok.body, { version: "aes128gcm", privateKey: phone, authSecret });
    expect(JSON.parse(plain.toString("utf8"))).toEqual({
      title: "Sunrise PG",
      body: "Meals for tomorrow close at 6:00 AM.",
      url: "/home",
    });
    // The push service said the second device no longer exists: it's removed.
    const left = await t.run((ctx) => ctx.db.query("pushSubscriptions").collect());
    expect(left.map((s) => s._id)).toEqual([ids.ok]);
  } finally {
    https.globalAgent.options.ca = previousCa;
    server.close();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
});
