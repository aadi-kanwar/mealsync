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

// Every day at 00:10 India time, residents whose last day has passed are
// marked as moved out.
crons.daily("end finished stays", { hourUTC: 18, minuteUTC: 40 }, internal.residents.endStays, {});

// Every 5 minutes, send the phone reminder if one of the times set in
// Settings is due (at most once per time per day).
crons.interval("send meal reminders", { minutes: 5 }, internal.notifications.sendDueReminders, {});

export default crons;
