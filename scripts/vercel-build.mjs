// The build Vercel runs (`npm run vercel-build`). With CONVEX_DEPLOY_KEY set
// (the production deploy key, in Vercel's project settings) it also makes
// sure the Convex deployment is ready, so going live needs no manual setup:
//   1. login signing keys (JWT_PRIVATE_KEY, JWKS): created once if missing
//   2. phone reminder signing keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY): same
//   3. SITE_URL: kept equal to the site's production address
//   4. the backend code is deployed and the website is built against it
//   5. the PG record exists (created once; the Admin renames it in Settings)
// Without the key (e.g. preview builds) it builds the website only.
// Secret values are never printed.
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import webpush from "web-push";

const quiet = (args) => execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const loud = (args) => execFileSync("npx", args, { stdio: "inherit" });
const envGet = (name) => quiet(["convex", "env", "get", name]).trim();
const envSet = (name, value) => quiet(["convex", "env", "set", name, "--", value]);

if (!process.env.CONVEX_DEPLOY_KEY) {
  console.log("No CONVEX_DEPLOY_KEY: building the website only.");
  loud(["next", "build"]);
  process.exit(0);
}

if (process.env.CONVEX_DEPLOY_KEY.startsWith("prod:") && envGet("MEALSYNC_ALLOW_DEV_SEED") === "true") {
  throw new Error("MEALSYNC_ALLOW_DEV_SEED is set on the production deployment. Remove it before deploying.");
}

if (envGet("JWT_PRIVATE_KEY") === "" || envGet("JWKS") === "") {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  envSet("JWT_PRIVATE_KEY", (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " "));
  envSet("JWKS", JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] }));
  console.log("Created the login signing keys on the Convex deployment.");
}

if (envGet("VAPID_PUBLIC_KEY") === "" || envGet("VAPID_PRIVATE_KEY") === "") {
  const keys = webpush.generateVAPIDKeys();
  envSet("VAPID_PUBLIC_KEY", keys.publicKey);
  envSet("VAPID_PRIVATE_KEY", keys.privateKey);
  console.log("Created the phone reminder signing keys on the Convex deployment.");
}

const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (host && envGet("SITE_URL") !== `https://${host}`) {
  envSet("SITE_URL", `https://${host}`);
  console.log(`Set SITE_URL to https://${host}.`);
}

loud(["convex", "deploy", "--cmd", "npm run build"]);

const names = {
  organizationName: process.env.MEALSYNC_ORGANIZATION_NAME || "My Organisation",
  propertyName: process.env.MEALSYNC_PG_NAME || "My PG",
};
console.log(quiet(["convex", "run", "setup:createProperty", JSON.stringify(names)]).trim());
