import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every day at 00:05 India time (18:35 UTC), make sure meal services exist
// for today and the next 7 days. Safe to rerun; the app also creates missing
// services on demand.
crons.daily(
  "create upcoming meal services",
  { hourUTC: 18, minuteUTC: 35 },
  internal.meals.generateUpcoming,
  {},
);

export default crons;
