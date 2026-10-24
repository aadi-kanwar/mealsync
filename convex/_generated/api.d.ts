/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_property from "../lib/property.js";
import type * as lib_staffRoles from "../lib/staffRoles.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as residents from "../residents.js";
import type * as seed from "../seed.js";
import type * as setup from "../setup.js";
import type * as staff from "../staff.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authLimits: typeof authLimits;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/inputRules": typeof lib_inputRules;
  "lib/property": typeof lib_property;
  "lib/staffRoles": typeof lib_staffRoles;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  residents: typeof residents;
  seed: typeof seed;
  setup: typeof setup;
  staff: typeof staff;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
