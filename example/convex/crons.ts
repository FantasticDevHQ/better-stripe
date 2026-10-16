import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "automatic recipient payouts",
  { minutes: 5 },
  internal.payoutWorkers.actions.dispatch,
  {},
);
crons.interval(
  "reconcile affiliate recovery receipts",
  { minutes: 5 },
  internal.affiliateRecovery.jobs.actions.start,
  {},
);
export default crons;
