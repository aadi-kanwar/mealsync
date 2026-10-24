import { ConvexError } from "convex/values";

/**
 * Error codes the browser can recognise. Messages are written for residents
 * and staff, never for programmers, and never reveal private details.
 */
export type AppErrorCode =
  | "NOT_SIGNED_IN"
  | "PROFILE_REQUIRED"
  | "PROFILE_EXISTS"
  | "ACCOUNT_DISABLED"
  | "FORBIDDEN"
  | "RESIDENT_NOT_ACTIVE"
  | "NOT_SET_UP"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "SIGN_IN_FAILED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_PHONE"
  | "WEAK_PASSWORD";

export type AppErrorData = { code: AppErrorCode; message: string };

export const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  NOT_SIGNED_IN: "Please sign in to continue.",
  PROFILE_REQUIRED: "Please finish setting up your profile first.",
  PROFILE_EXISTS: "Your profile is already set up.",
  ACCOUNT_DISABLED: "This account has been switched off. Please contact the PG office.",
  FORBIDDEN: "You don't have permission to do that.",
  RESIDENT_NOT_ACTIVE: "Your account is waiting for approval by the Warden.",
  NOT_SET_UP: "MealSync hasn't been set up for this PG yet. Please contact the PG office.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  INVALID_INPUT: "Some details aren't valid. Please check and try again.",
  CONFLICT: "That has already been done.",
  SIGN_IN_FAILED: "That phone number and password didn't work. Please check and try again.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Please wait 15 minutes and try again.",
  INVALID_PHONE: "Enter a valid mobile number.",
  WEAK_PASSWORD: "Please choose a stronger password.",
};

export function appError(code: AppErrorCode, message?: string): ConvexError<AppErrorData> {
  return new ConvexError({ code, message: message ?? DEFAULT_MESSAGES[code] });
}
