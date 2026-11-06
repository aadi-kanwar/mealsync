import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { FAILED_ATTEMPTS_LIMIT } from "./authLimits";
import { appError } from "./lib/errors";
import { SESSION_INACTIVE_MS, SESSION_TOTAL_MS } from "./lib/sessions";
import { normalizePhone, organizationSignUpSchema, passwordProblem, profileSchema } from "./lib/inputRules";

export const PHONE_PASSWORD_PROVIDER = "phone-password";

/**
 * Phone number + password login.
 *
 * The browser calls `signIn("phone-password", { flow, phone, password })`
 * where flow is "signIn" or "signUp". A resident's sign-up also sends
 * `displayName`, `roomNumber` and the `propertyId` of their PG, so they're
 * asked only once. An Admin's sign-up (`account: "organization"`) sends
 * `displayName`, `organizationName` and `propertyName` instead, and creates
 * their organisation with its first property. Every
 * failure that could reveal whether a number is registered returns the same
 * SIGN_IN_FAILED message.
 */
const PhonePassword = ConvexCredentials<DataModel>({
  id: PHONE_PASSWORD_PROVIDER,
  authorize: async (params, ctx) => {
    const phone = typeof params.phone === "string" ? normalizePhone(params.phone) : null;
    if (phone === null) throw appError("INVALID_PHONE");
    const password = typeof params.password === "string" ? params.password : "";
    const flow = params.flow;
    if (flow !== "signIn" && flow !== "signUp") throw appError("INVALID_INPUT");

    const gate = await ctx.runMutation(internal.authLimits.checkAttempt, { phone, flow });
    if (!gate.allowed) throw appError("TOO_MANY_ATTEMPTS");

    if (flow === "signUp") {
      const forOrganization = params.account === "organization";
      const details = forOrganization
        ? organizationSignUpSchema.safeParse({
            displayName: params.displayName,
            organizationName: params.organizationName,
            propertyName: params.propertyName,
          })
        : profileSchema.safeParse({ displayName: params.displayName, roomNumber: params.roomNumber });
      if (!details.success) throw appError("INVALID_INPUT", details.error.issues[0]?.message);
      const propertyId = typeof params.propertyId === "string" ? params.propertyId : "";
      if (!forOrganization && !(await ctx.runQuery(internal.directory.propertyIsOpen, { propertyId }))) {
        throw appError("INVALID_INPUT", "Choose your PG.");
      }
      const problem = passwordProblem(password, phone);
      if (problem !== null) throw appError("WEAK_PASSWORD", problem);
      if (!(await accountExists(ctx, phone))) {
        let userId;
        try {
          const { user } = await createAccount(ctx, {
            provider: PHONE_PASSWORD_PROVIDER,
            account: { id: phone, secret: password },
            profile: { phone },
          });
          userId = user._id;
        } catch {
          // Most likely the same number signed up a moment ago.
          await ctx.runMutation(internal.authLimits.recordFailure, { phone });
          throw appError("SIGN_IN_FAILED");
        }
        await ctx.runMutation(internal.authLimits.recordSignUp, {});
        try {
          if (details.data && "organizationName" in details.data) {
            await ctx.runMutation(internal.users.createOrganizationAtSignUp, { userId, ...details.data });
          } else {
            await ctx.runMutation(internal.users.createProfileAtSignUp, { userId, ...details.data, propertyId });
          }
        } catch (error) {
          // The account exists; the app will ask for the details once more.
          console.error("Saving the profile at sign-up failed", error);
        }
        return { userId };
      }
      // Number already registered: behave like a sign-in, so the person who
      // owns it gets in and anyone else gets the same generic error. The
      // details sent are ignored; an existing profile is never changed here.
    }
    return await signInExisting(ctx, phone, password);
  },
  crypto: {
    async hashSecret(password: string) {
      return await new Scrypt().hash(password);
    },
    async verifySecret(password: string, hash: string) {
      return await new Scrypt().verify(hash, password);
    },
  },
});

export const HUB_SSO_PROVIDER = "hub-sso";

/**
 * Admin Hub single sign-on (master admins only). The /sso page calls
 * `signIn("hub-sso", { ticket })` with the one-time ticket the hub signed.
 * Any failure gives the same SSO_LINK_EXPIRED message, never the reason.
 * The login it opens lasts 12 hours (see convex/sso.ts).
 */
const HubSso = ConvexCredentials<DataModel>({
  id: HUB_SSO_PROVIDER,
  authorize: async (params, ctx) => {
    const ticket = typeof params.ticket === "string" ? params.ticket : "";
    const claims = await ctx.runAction(internal.ssoNode.verifyTicket, { ticket });
    if (claims === null) throw appError("SSO_LINK_EXPIRED");
    const result = await ctx.runMutation(internal.sso.acceptTicket, claims);
    if (result === null) throw appError("SSO_LINK_EXPIRED");
    return result;
  },
});

async function accountExists(ctx: ActionCtx, phone: string): Promise<boolean> {
  try {
    await retrieveAccount(ctx, { provider: PHONE_PASSWORD_PROVIDER, account: { id: phone } });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "InvalidAccountId") return false;
    throw error;
  }
}

async function signInExisting(ctx: ActionCtx, phone: string, password: string) {
  if (password.length === 0) throw appError("SIGN_IN_FAILED");
  let userId;
  try {
    const { user } = await retrieveAccount(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: password },
    });
    userId = user._id;
  } catch (error) {
    if (error instanceof Error && error.message === "TooManyFailedAttempts") {
      throw appError("TOO_MANY_ATTEMPTS");
    }
    await ctx.runMutation(internal.authLimits.recordFailure, { phone });
    throw appError("SIGN_IN_FAILED");
  }
  await ctx.runMutation(internal.authLimits.clearFailures, { phone });
  return { userId };
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PhonePassword, HubSso],
  // Stay signed in: up to 90 days, or until Dine isn't opened for 30 days.
  // Signing out, or a password reset or change, still ends it at once.
  session: { totalDurationMs: SESSION_TOTAL_MS, inactiveDurationMs: SESSION_INACTIVE_MS },
  signIn: {
    // Convex Auth's own per-account limit. Kept well above ours
    // (FAILED_ATTEMPTS_LIMIT per 15 minutes) so ours always applies first and
    // registered and unregistered numbers behave the same.
    maxFailedAttempsPerHour: FAILED_ATTEMPTS_LIMIT * 4 + 10,
  },
});
