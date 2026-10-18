import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { activateRevisionAccount } from "../payoutRevisionJournal/state.js";
import { inventoryTables, jobDoc } from "./schema.js";

/** Trusted-host layout inventory. This grants no financial coverage or eligibility. */
export const begin = mutation({
  args: { operationKey: v.string() },
  returns: jobDoc,
  handler: async (ctx, { operationKey }) => {
    if (!operationKey || operationKey.length > 256)
      throw new Error("Invalid migration operation key.");
    const prior = await ctx.db
      .query("payoutRevisionMigrations")
      .withIndex("by_operation", (q) => q.eq("operationKey", operationKey))
      .unique();
    if (prior) return prior;
    const id = await ctx.db.insert("payoutRevisionMigrations", {
      operationKey,
      phase: 0,
      cursor: null,
      step: 0,
      status: "running",
      scanned: 0,
      visited: 0,
      activated: 0,
      unchanged: 0,
      held: 0,
    });
    return (await ctx.db.get("payoutRevisionMigrations", id))!;
  },
});

/** One inventory row and at most one account activation per committed step. */
export const resume = mutation({
  args: { jobId: v.id("payoutRevisionMigrations"), expectedStep: v.number() },
  returns: jobDoc,
  handler: async (ctx, { jobId, expectedStep }) => {
    const job = await ctx.db.get("payoutRevisionMigrations", jobId);
    if (!job) throw new Error("Migration not found.");
    const counters = [
      job.step,
      job.scanned,
      job.visited,
      job.activated,
      job.unchanged,
      job.held,
    ];
    if (
      counters.some(
        (value) =>
          !Number.isSafeInteger(value) ||
          value < 0 ||
          (job.status === "running" && value === Number.MAX_SAFE_INTEGER),
      ) ||
      !Number.isInteger(job.phase) ||
      job.phase < 0 ||
      (job.status === "running"
        ? job.phase >= inventoryTables.length
        : job.phase !== inventoryTables.length || job.cursor !== null) ||
      BigInt(job.activated) + BigInt(job.unchanged) + BigInt(job.held) !==
        BigInt(job.visited) ||
      job.visited > job.scanned
    )
      throw new Error("Invalid migration job state.");
    if (
      !Number.isSafeInteger(expectedStep) ||
      expectedStep < 0 ||
      expectedStep > job.step
    )
      throw new Error("Invalid migration step.");
    if (expectedStep < job.step || job.status === "finished") return job;
    const table = inventoryTables[job.phase];
    if (!table) throw new Error("Invalid migration inventory phase.");
    const page = await paginator(ctx.db, schema).query(table).paginate({
      numItems: 1,
      cursor: job.cursor,
      maximumRowsRead: 1,
      maximumBytesRead: 1100000,
    });
    let activated = job.activated,
      unchanged = job.unchanged,
      held = job.held,
      visited = job.visited;
    for (const row of page.page) {
      const accountId =
        "destinationAccountId" in row
          ? row.destinationAccountId
          : row.accountId;
      const accountDigest = await generateIdempotencyKey(
        "payout-revision-migration-account",
        { accountId },
      );
      const seen = await ctx.db
        .query("payoutRevisionMigrationResults")
        .withIndex("by_job_account", (q) =>
          q.eq("jobId", jobId).eq("accountDigest", accountDigest),
        )
        .unique();
      if (seen) continue;
      const result = await activateRevisionAccount(ctx, accountId);
      await ctx.db.insert("payoutRevisionMigrationResults", {
        jobId,
        status: result.status,
        ...(result.status === "held" ? { reason: result.reason } : {}),
        ...(new TextEncoder().encode(accountId).length <= 256
          ? { accountId }
          : {}),
        accountDigest,
        sourceId: row._id,
        sourceTable: table,
      });
      visited++;
      if (result.status === "activated") activated++;
      else if (result.status === "unchanged") unchanged++;
      else held++;
    }
    const phase = job.phase + (page.isDone ? 1 : 0);
    await ctx.db.patch("payoutRevisionMigrations", jobId, {
      phase,
      cursor: page.isDone ? null : page.continueCursor,
      step: job.step + 1,
      scanned: job.scanned + page.page.length,
      visited,
      activated,
      unchanged,
      held,
      status: phase === inventoryTables.length ? "finished" : "running",
    });
    return (await ctx.db.get("payoutRevisionMigrations", jobId))!;
  },
});
