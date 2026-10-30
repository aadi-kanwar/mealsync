/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as authLimits from "../authLimits.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as directory from "../directory.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_csv from "../lib/csv.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_headcount from "../lib/headcount.js";
import type * as lib_inputRules from "../lib/inputRules.js";
import type * as lib_meals from "../lib/meals.js";
import type * as lib_menus from "../lib/menus.js";
import type * as lib_messages from "../lib/messages.js";
import type * as lib_property from "../lib/property.js";
import type * as lib_reminders from "../lib/reminders.js";
import type * as lib_staffRoles from "../lib/staffRoles.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validators from "../lib/validators.js";
import type * as meals from "../meals.js";
import type * as menus from "../menus.js";
import type * as notifications from "../notifications.js";
import type * as push from "../push.js";
import type * as reports from "../reports.js";
import type * as residents from "../residents.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as setup from "../setup.js";
import type * as staff from "../staff.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  authLimits: typeof authLimits;
  crons: typeof crons;
  dashboard: typeof dashboard;
  directory: typeof directory;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/csv": typeof lib_csv;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/headcount": typeof lib_headcount;
  "lib/inputRules": typeof lib_inputRules;
  "lib/meals": typeof lib_meals;
  "lib/menus": typeof lib_menus;
  "lib/messages": typeof lib_messages;
  "lib/property": typeof lib_property;
  "lib/reminders": typeof lib_reminders;
  "lib/staffRoles": typeof lib_staffRoles;
  "lib/time": typeof lib_time;
  "lib/validators": typeof lib_validators;
  meals: typeof meals;
  menus: typeof menus;
  notifications: typeof notifications;
  push: typeof push;
  reports: typeof reports;
  residents: typeof residents;
  seed: typeof seed;
  settings: typeof settings;
  setup: typeof setup;
  staff: typeof staff;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
