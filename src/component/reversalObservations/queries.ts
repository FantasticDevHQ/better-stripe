import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { validPayload } from "./integrity.js";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { operationResult } from "./schema.js";
import { header, readState } from "./state.js";
export const operation = query({
  args: { operationId: v.id("transferReversalOps") },
  returns: operationResult,
  handler: async (ctx, { operationId }) => ({
    ...(await readState(ctx)),
    observation: await header(ctx, operationId),
  }),
});

import { paginationOptsValidator } from "convex/server";
import { headerDoc, sliceDoc, payloadDoc } from "./schema.js";
import { boundedPage, pageResult, readFields } from "./pagination.js";
import { bucketDigest, ownerDigest } from "./selectors.js";
import { selectorDigest } from "../operationEvidence/helpers.js";
export const slices = query({
  args: {
    operationId: v.id("transferReversalOps"),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageResult(sliceDoc),
  handler: async (ctx, { operationId, paginationOpts }) => {
    const options = boundedPage(paginationOpts);
    const row = await header(ctx, operationId);
    if (!row)
      return {
        ...(await readState(ctx)),
        page: [],
        isDone: true,
        continueCursor: "",
      };
    return {
      ...(await readState(ctx)),
      ...(await paginator(ctx.db, schema)
        .query("reversalObservationSlices")
        .withIndex("by_observation_slice", (q) =>
          q.eq("observationId", row._id),
        )
        .paginate(options)),
    };
  },
});
export const bucket = query({
  args: { bucketKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: pageResult(sliceDoc),
  handler: async (ctx, { bucketKey, paginationOpts }) => {
    const digest = await bucketDigest(bucketKey);
    return {
      ...(await readState(ctx)),
      ...(await paginator(ctx.db, schema)
        .query("reversalObservationSlices")
        .withIndex("by_bucket", (q) => q.eq("bucketDigest", digest))
        .paginate(boundedPage(paginationOpts))),
    };
  },
});
export const owner = query({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageResult(sliceDoc),
  handler: async (ctx, { userId, orgId, paginationOpts }) => {
    const digest = await ownerDigest(userId, orgId);
    return {
      ...(await readState(ctx)),
      ...(await paginator(ctx.db, schema)
        .query("reversalObservationSlices")
        .withIndex("by_owner", (q) => q.eq("ownerDigest", digest))
        .paginate(boundedPage(paginationOpts))),
    };
  },
});
export const history = query({
  args: {
    selector: v.union(v.literal("operationId"), v.literal("sourceChargeId")),
    value: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageResult(headerDoc),
  handler: async (ctx, { selector, value, paginationOpts }) => {
    const digest = await selectorDigest(selector, value);
    const rows =
      selector === "operationId"
        ? paginator(ctx.db, schema)
            .query("reversalObservations")
            .withIndex("by_operation_digest", (q) =>
              q.eq("operationDigest", digest),
            )
        : paginator(ctx.db, schema)
            .query("reversalObservations")
            .withIndex("by_source_charge_digest", (q) =>
              q.eq("sourceChargeDigest", digest),
            );
    return {
      ...(await readState(ctx)),
      ...(await rows.paginate(boundedPage(paginationOpts))),
    };
  },
});
export const payload = query({
  args: {
    operationId: v.id("transferReversalOps"),
    version: v.union(v.literal("original"), v.literal("latest")),
  },
  returns: v.object({ ...readFields, payload: v.union(payloadDoc, v.null()) }),
  handler: async (ctx, { operationId, version }) => {
    const row = await header(ctx, operationId);
    return {
      ...(await readState(ctx)),
      payload: row ? await validPayload(ctx, row, version) : null,
    };
  },
});
