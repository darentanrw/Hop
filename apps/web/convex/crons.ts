import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("run matching", { minutes: 2 }, internal.mutations.runMatchingCron);

crons.interval("lock tentative groups (T-3h)", { minutes: 5 }, internal.mutations.lockGroups);

crons.interval(
  "hard-lock semi-locked groups (T-30min)",
  { minutes: 5 },
  internal.mutations.hardLockGroups,
);

export default crons;
