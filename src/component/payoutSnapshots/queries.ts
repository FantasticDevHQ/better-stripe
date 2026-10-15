import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import { identity } from "./scope.js";
import { snapshotDoc } from "./schema.js";
import { ownedSnapshot } from "./localState.js";
import { riskRevision } from "./revisions.js";
import { transferDocValidator } from "../connect/validators.js";
import { claimDoc } from "../payoutRelease/schema.js";
import {
  transferFingerprint,
  payoutClaimFingerprint,
} from "../payoutRelease/helpers.js";
export const get = query({
  args: identity,
  returns: v.union(snapshotDoc, v.null()),
  handler: ownedSnapshot,
});
const args = { ...identity, paginationOpts: paginationOptsValidator };
const pageFields = { continueCursor: v.string(), isDone: v.boolean() };
export const sources = query({
  args,
  returns: v.object({ ...pageFields, page: v.array(transferDocValidator) }),
  handler: async (ctx, args) => {
    const h = await ownedSnapshot(ctx, args);
    if (
      !h ||
      !h.readOnly ||
      h.phase !== "local_ready" ||
      h.expiresAt <= Date.now() ||
      (await riskRevision(ctx, h.accountId)) !== h.riskRevision
    )
      throw new Error(
        "Payout collection is not ready for provider verification.",
      );
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 25
    )
      throw new Error("Invalid collection page.");
    const page = await paginator(ctx.db, schema)
      .query("payoutSnapshotSources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", h._id))
      .paginate(args.paginationOpts);
    const rows = [];
    for (const cached of page.page) {
      const row = await ctx.db
        .query("transfers")
        .withIndex("by_stripe_transfer_id", (q) =>
          q.eq("stripeTransferId", cached.stripeTransferId),
        )
        .unique();
      if (!row || transferFingerprint(row) !== cached.ledgerFingerprint)
        throw new Error("Payout collection source changed.");
      rows.push(row);
    }
    return { ...page, page: rows };
  },
});
export const claims = query({
  args,
  returns: v.object({ ...pageFields, page: v.array(claimDoc) }),
  handler: async (ctx, args) => {
    const h = await ownedSnapshot(ctx, args);
    if (
      !h ||
      !h.readOnly ||
      h.phase !== "local_ready" ||
      h.expiresAt <= Date.now() ||
      (await riskRevision(ctx, h.accountId)) !== h.riskRevision
    )
      throw new Error(
        "Payout collection is not ready for provider verification.",
      );
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 25
    )
      throw new Error("Invalid collection page.");
    const page = await paginator(ctx.db, schema)
      .query("payoutSnapshotClaims")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", h._id))
      .paginate(args.paginationOpts);
    const rows = [];
    for (const cached of page.page) {
      const row = await ctx.db
        .query("payoutReleaseClaims")
        .withIndex("by_operation", (q) =>
          q.eq("operationKey", cached.operationKey),
        )
        .unique();
      if (!row || payoutClaimFingerprint(row) !== cached.fingerprint)
        throw new Error("Payout collection claim changed.");
      rows.push(row);
    }
    return { ...page, page: rows };
  },
});
