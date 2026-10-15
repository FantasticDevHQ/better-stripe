import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "automatic recipient payouts",
  { minutes: 5 },
  internal.payoutWorkers.dispatch,
  {},
);
export default crons;
