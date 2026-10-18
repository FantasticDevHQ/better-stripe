import { validPayload } from "./integrity.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { operationResult } from "./schema.js";
import { header, readState } from "./state.js";
import { indexSlice } from "./indexSlice.js";
import { lifecycleScope } from "./capture.js";
import { referenceChunkSize } from "./references.js";
import { identityFingerprint } from "../operationEvidence/helpers.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import {
  advanceObservationGeneration,
  observationGeneration,
} from "../financialObservations/generations.js";
import { transferProducerScope } from "../financialObservations/transferHelpers.js";
/** Trusted-host bounded diagnostic enrichment; never executes a reversal or grants coverage. */
export const resume = mutation({
  args: {
    operationId: v.id("transferReversalOps"),
    expectedGeneration: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: operationResult,
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 10;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20)
      throw new Error(
        "Reversal observation batch must contain 1 to 20 slices.",
      );
    const row = await header(ctx, args.operationId);
    if (!row) return { ...(await readState(ctx)), observation: null };
    if (args.expectedGeneration !== row.generation)
      throw new Error("Reversal observation generation changed.");
    if (row.status === "held" || row.status === "complete")
      return { ...(await readState(ctx)), observation: row };
    const payload = await validPayload(ctx, row, "original");
    const hold = async () => {
      await ctx.db.patch("reversalObservations", row._id, { status: "held" });
      await advanceObservationGeneration(ctx, lifecycleScope);
    };
    if (
      !payload ||
      payload.slices.length !== row.sliceCount ||
      (await identityFingerprint(payload)) !== row.originalIdentityFingerprint
    ) {
      await hold();
      return {
        ...(await readState(ctx)),
        observation: await header(ctx, args.operationId),
      };
    }
    const producerGeneration = await observationGeneration(
      ctx,
      transferProducerScope,
    );
    if (producerGeneration === null) {
      await hold();
      return {
        ...(await readState(ctx)),
        observation: await header(ctx, args.operationId),
      };
    }
    if (
      (row.nextIndex !== 0 || row.status === "validating") &&
      producerGeneration !== row.indexTransferGeneration
    ) {
      await ctx.db.patch("reversalObservations", row._id, {
        status: "pending",
        nextIndex: 0,
        indexTransferGeneration: producerGeneration,
      });
      await advanceObservationGeneration(ctx, lifecycleScope);
      return {
        ...(await readState(ctx)),
        observation: await header(ctx, args.operationId),
      };
    }
    let indexedCount = row.indexedCount;
    const limit = Math.min(row.sliceCount, row.nextIndex + batchSize);
    let end = row.nextIndex;
    for (let i = row.nextIndex; i < limit; i++) {
      const budget = await ctx.meta.getTransactionMetrics();
      if (
        budget.bytesRead.remaining < 9_000_000 ||
        budget.databaseQueries.remaining < 16
      ) {
        if (end === row.nextIndex)
          throw new Error(
            "Reversal observation requires a fresh transaction with read headroom.",
          );
        break;
      }
      const chunks = await ctx.db
        .query("reversalObservationRefs")
        .withIndex("by_observation_chunk", (q) =>
          q
            .eq("observationId", row._id)
            .eq("chunkIndex", Math.floor(i / referenceChunkSize)),
        )
        .take(2);
      const reference = chunks[0]?.refs[i % referenceChunkSize];
      const chunkIndex = Math.floor(i / referenceChunkSize);
      if (
        chunks.length === 1 &&
        (await canonicalFingerprint({ refs: chunks[0].refs })) !==
          row.referenceFingerprints[chunkIndex]
      ) {
        await hold();
        return {
          ...(await readState(ctx)),
          observation: await header(ctx, args.operationId),
        };
      }
      if (chunks.length !== 1 || reference === undefined) {
        await hold();
        return {
          ...(await readState(ctx)),
          observation: await header(ctx, args.operationId),
        };
      }
      const indexed = await indexSlice(
        ctx,
        reference,
        payload.slices[i].stripeTransferId,
        payload.sourceChargeId,
      );
      if (!indexed) {
        await hold();
        return {
          ...(await readState(ctx)),
          observation: await header(ctx, args.operationId),
        };
      }
      const fields = {
        observationId: row._id,
        originalOperationId: row.originalOperationId,
        sliceIndex: i,
        generation: row.generation,
        ...indexed,
      };
      const existing = await ctx.db
        .query("reversalObservationSlices")
        .withIndex("by_observation_slice", (q) =>
          q.eq("observationId", row._id).eq("sliceIndex", i),
        )
        .take(2);
      if (existing.length > 1) {
        await hold();
        return {
          ...(await readState(ctx)),
          observation: await header(ctx, args.operationId),
        };
      }
      if (row.status === "validating") {
        const prior = existing[0];
        if (!prior) {
          await hold();
          return {
            ...(await readState(ctx)),
            observation: await header(ctx, args.operationId),
          };
        }
        const { _id, _creationTime, ...stored } = prior;
        void _id;
        void _creationTime;
        if (
          (await canonicalFingerprint(stored)) !==
          (await canonicalFingerprint(fields))
        ) {
          await hold();
          return {
            ...(await readState(ctx)),
            observation: await header(ctx, args.operationId),
          };
        }
      } else if (!existing[0] && i < indexedCount) {
        await hold();
        return {
          ...(await readState(ctx)),
          observation: await header(ctx, args.operationId),
        };
      } else if (existing[0])
        await ctx.db.replace(
          "reversalObservationSlices",
          existing[0]._id,
          fields,
        );
      else {
        await ctx.db.insert("reversalObservationSlices", fields);
        indexedCount++;
      }
      end = i + 1;
    }
    await ctx.db.patch("reversalObservations", row._id, {
      indexedCount,
      indexTransferGeneration: producerGeneration,
      nextIndex: end === row.sliceCount ? 0 : end,
      status:
        end === row.sliceCount
          ? row.status === "validating"
            ? "complete"
            : "validating"
          : row.status,
    });
    await advanceObservationGeneration(ctx, lifecycleScope);
    return {
      ...(await readState(ctx)),
      observation: await header(ctx, args.operationId),
    };
  },
});
