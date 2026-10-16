import { v } from "convex/values";

import { query } from "../../../_generated/server";

import { FIXTURE_VERSION } from "../../plan";
import { jobDoc } from "../helpers";

export const status = query({
  args: {},
  returns: v.union(jobDoc, v.null()),
  handler: (ctx) =>
    ctx.db
      .query("sandboxFixtureJobs")
      .withIndex("by_version", (q) => q.eq("version", FIXTURE_VERSION))
      .first(),
});
