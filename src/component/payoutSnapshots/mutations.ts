import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { v } from "convex/values";
import { mutation } from "../earnings/triggers.js";
import { readPolicy } from "../payoutPolicy/helpers.js";
import { identity, validateIdentity } from "./scope.js";
import { snapshotDoc } from "./schema.js";
import { financialRevision, riskRevision } from "./revisions.js";
import {
  ownedSnapshot,
  cacheSource,
  cacheClaim,
  cacheFee,
  CollectionError,
  type Counts,
  type Snapshot,
} from "./localState.js";
export const begin = mutation({
  args: { ...identity, expectedRevision: v.number() },
  returns: snapshotDoc,
  handler: async (ctx, args) => {
    validateIdentity(args);
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < -1
    )
      throw new Error("Invalid collection policy revision.");
    const old = await ownedSnapshot(ctx, args);
    if (old) {
      if (old.expectedRevision !== args.expectedRevision)
        throw new Error(
          "Collection identity cannot be reused at another revision.",
        );
      return old;
    }
    const policy = await readPolicy(ctx, args);
    if ((policy?.revision ?? -1) !== args.expectedRevision)
      throw new Error("Collection policy revision changed.");
    const revision = await financialRevision(ctx, args.accountId);
    const newest = await ctx.db
      .query("transfers")
      .withIndex("by_destination_account_id", (q) =>
        q.eq("destinationAccountId", args.accountId),
      )
      .order("desc")
      .first();
    const id = await ctx.db.insert("payoutSnapshots", {
      ...args,
      readOnly: true,
      policyMode: policy?.mode,
      policyOperationKey: policy?.operationKey,
      phase: "sources",
      step: 0,
      sourceFence: newest?._creationTime ?? 0,
      initialRevision: revision.revision,
      initialRiskRevision: revision.riskRevision,
      riskRevision: revision.riskRevision,
      observedRevision: revision.revision,
      sourceCount: 0,
      allocationCount: 0,
      claimCount: 0,
      feeCount: 0,
      deferredPositiveChanges: false,
      providerChanged: false,
      expiresAt: Date.now() + 86400000,
    });
    return (await ctx.db.get("payoutSnapshots", id))!;
  },
});
export const advance = mutation({
  args: {
    ...identity,
    expectedStep: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: snapshotDoc,
  handler: async (ctx, args) => {
    let h = await ownedSnapshot(ctx, args);
    if (!h) throw new Error("Collection is unavailable.");
    if (!h.readOnly) throw new Error("Collection is financially bound.");
    if (h.phase === "discarding") return h;
    if (
      !Number.isSafeInteger(args.expectedStep) ||
      args.expectedStep < 0 ||
      h.step < args.expectedStep
    )
      throw new Error("Invalid collection step.");
    const batch = args.batchSize ?? (h.phase === "claims" ? 5 : 25);
    if (!Number.isInteger(batch) || batch < 1 || batch > 25)
      throw new Error("Collection batch must be between 1 and 25.");
    if (h.phase === "invalidated") return h;
    const policy = await readPolicy(ctx, args);
    const invalidate = async (reason: string) => {
      await ctx.db.patch("payoutSnapshots", h!._id, {
        phase: "invalidated",
        reason,
        step: h!.step + 1,
      });
      return (await ctx.db.get("payoutSnapshots", h!._id))!;
    };
    if (
      (policy?.revision ?? -1) !== h.expectedRevision ||
      policy?.mode !== h.policyMode ||
      policy?.operationKey !== h.policyOperationKey
    )
      return invalidate("policy_changed");
    if (h.expiresAt <= Date.now()) return invalidate("collection_expired");
    const currentRisk = await riskRevision(ctx, h.accountId);
    if (h.phase === "local_ready") {
      if (currentRisk === h.riskRevision) return h;
      await ctx.db.patch("payoutSnapshots", h._id, { phase: "repair" });
      h = (await ctx.db.get("payoutSnapshots", h._id))!;
    }
    if (h.step > args.expectedStep) return h;
    const counts: Counts = {
      sourceCount: h.sourceCount,
      allocationCount: h.allocationCount,
      claimCount: h.claimCount,
      feeCount: h.feeCount,
    };
    const patch: Partial<Snapshot> = { step: h.step + 1 };
    try {
      if (h.phase === "sources") {
        const page = await paginator(ctx.db, schema)
          .query("transfers")
          .withIndex("by_destination_account_id", (q) =>
            q
              .eq("destinationAccountId", h!.accountId)
              .lte("_creationTime", h!.sourceFence),
          )
          .paginate({ cursor: h.sourceCursor ?? null, numItems: batch });
        for (const row of page.page)
          await cacheSource(ctx, h, row.stripeTransferId, counts, row);
        patch.sourceCursor = page.continueCursor;
        patch.phase = page.isDone ? "allocations" : "sources";
      } else if (h.phase === "allocations") {
        const page = await paginator(ctx.db, schema)
          .query("payoutSourceAllocations")
          .withIndex("by_account", (q) => q.eq("accountId", h!.accountId))
          .paginate({ cursor: h.allocationCursor ?? null, numItems: batch });
        for (const row of page.page)
          await cacheSource(ctx, h, row.stripeTransferId, counts);
        patch.allocationCursor = page.continueCursor;
        patch.phase = page.isDone ? "fees" : "allocations";
      } else if (h.phase === "fees") {
        const page = await paginator(ctx.db, schema)
          .query("payoutFeeBalances")
          .withIndex("by_account_currency", (q) =>
            q.eq("accountId", h!.accountId),
          )
          .paginate({ cursor: h.feeCursor ?? null, numItems: batch });
        for (const row of page.page)
          await cacheFee(ctx, h, row.currency, counts);
        patch.feeCursor = page.continueCursor;
        patch.phase = page.isDone ? "claims" : "fees";
      } else if (h.phase === "claims") {
        const page = await paginator(ctx.db, schema)
          .query("payoutReleaseClaims")
          .withIndex("by_account_status", (q) =>
            q.eq("accountId", h!.accountId),
          )
          .paginate({ cursor: h.claimCursor ?? null, numItems: batch });
        for (const row of page.page)
          await cacheClaim(ctx, h, row.operationKey, counts);
        patch.claimCursor = page.continueCursor;
        patch.phase = page.isDone ? "repair" : "claims";
      } else if (h.phase === "repair") {
        const events = await ctx.db
          .query("payoutRiskEvents")
          .withIndex("by_account_revision", (q) =>
            q
              .eq("accountId", h!.accountId)
              .gt("riskRevision", h!.riskRevision)
              .lte("riskRevision", currentRisk),
          )
          .take(batch);
        let risk = h.riskRevision;
        for (const event of events) {
          if (event.riskRevision !== risk + 1)
            throw new CollectionError("risk_history_incomplete");
          if (event.removed) throw new CollectionError(`${event.kind}_removed`);
          if (event.kind === "transfer" || event.kind === "allocation")
            await cacheSource(ctx, h, event.key, counts);
          else if (event.kind === "claim")
            await cacheClaim(ctx, h, event.key, counts);
          else if (event.kind === "liability")
            throw new CollectionError("liability_changed");
          else if (event.kind === "fee")
            await cacheFee(ctx, h, event.key, counts);
          else patch.providerChanged = true;
          risk = event.riskRevision;
        }
        if (!events.length && risk !== currentRisk)
          throw new CollectionError("risk_history_incomplete");
        patch.riskRevision = risk;
        patch.phase = risk === currentRisk ? "check" : "repair";
      } else if (h.phase === "check") {
        if (currentRisk !== h.riskRevision) patch.phase = "repair";
        else {
          const pending = await ctx.db
            .query("payoutSnapshotSources")
            .withIndex("by_snapshot_check", (q) =>
              q.eq("snapshotId", h!._id).eq("needsCheck", true),
            )
            .take(batch);
          for (const s of pending) {
            if (
              s.expectedPaid !== s.paidAmount ||
              s.expectedReserved !== s.reservedAmount
            )
              throw new CollectionError("source_allocation_mismatch");
            await ctx.db.patch("payoutSnapshotSources", s._id, {
              needsCheck: false,
            });
          }
          if (!pending.length) {
            patch.phase = "local_ready";
            const revision = await financialRevision(ctx, h.accountId);
            patch.observedRevision = revision.revision;
            patch.deferredPositiveChanges =
              revision.revision - h.initialRevision >
              currentRisk - h.initialRiskRevision;
          }
        }
      }
    } catch (error) {
      if (error instanceof CollectionError) return invalidate(error.reason);
      throw error;
    }
    await ctx.db.patch("payoutSnapshots", h._id, { ...patch, ...counts });
    return (await ctx.db.get("payoutSnapshots", h._id))!;
  },
});

/** Read-only cache cleanup. Never releases source reservations or bank claims. */
export const discard = mutation({
  args: { ...identity, batchSize: v.optional(v.number()) },
  returns: v.union(snapshotDoc, v.null()),
  handler: async (ctx, args) => {
    const h = await ownedSnapshot(ctx, args);
    if (!h) return null;
    if (!h.readOnly) throw new Error("Collection is financially bound.");
    const batch = args.batchSize ?? 25;
    if (!Number.isInteger(batch) || batch < 1 || batch > 100)
      throw new Error("Invalid collection cleanup batch.");
    const sources = await ctx.db
      .query("payoutSnapshotSources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", h._id))
      .take(batch);
    const claims = await ctx.db
      .query("payoutSnapshotClaims")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", h._id))
      .take(batch);
    const fees = await ctx.db
      .query("payoutSnapshotFees")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", h._id))
      .take(batch);
    if (!sources.length && !claims.length && !fees.length) {
      await ctx.db.delete("payoutSnapshots", h._id);
      return null;
    }
    for (const s of sources)
      await ctx.db.delete("payoutSnapshotSources", s._id);
    for (const c of claims) await ctx.db.delete("payoutSnapshotClaims", c._id);
    for (const f of fees) await ctx.db.delete("payoutSnapshotFees", f._id);
    await ctx.db.patch("payoutSnapshots", h._id, {
      phase: "discarding",
      step: h.step + 1,
      sourceCount: Math.max(0, h.sourceCount - sources.length),
      allocationCount: Math.max(
        0,
        h.allocationCount - sources.filter((s) => s.allocationPresent).length,
      ),
      claimCount: Math.max(0, h.claimCount - claims.length),
      feeCount: Math.max(0, h.feeCount - fees.length),
    });
    return (await ctx.db.get("payoutSnapshots", h._id))!;
  },
});
