import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import {
  bodyOf,
  isValidHeader,
  readState,
  selectorDigest,
  sourceFingerprint,
} from "./helpers.js";
import {
  headerDoc,
  headerResult,
  payloadResult,
  readFields,
  selectorValidator,
} from "./schema.js";

async function hydrate(
  ctx: QueryCtx,
  headerId: Id<"operationEvidenceHeaders">,
  kind: "original" | "latest",
) {
  const header = await ctx.db.get("operationEvidenceHeaders", headerId);
  if (!header || !isValidHeader(header))
    return { header: null, payload: null, ...(await readState(ctx)) };
  const id =
    kind === "original" ? header.originalPayloadId : header.latestPayloadId;
  const expected =
    kind === "original" ? header.originalFingerprint : header.latestFingerprint;
  const payload = await ctx.db.get("operationEvidencePayloads", id);
  if (!payload || (await sourceFingerprint(bodyOf(payload))) !== expected)
    return { header, payload: null, ...(await readState(ctx)) };
  return { header, payload, ...(await readState(ctx)) };
}
export const original = query({
  args: { headerId: v.id("operationEvidenceHeaders") },
  returns: payloadResult,
  handler: (ctx, args) => hydrate(ctx, args.headerId, "original"),
});
export const latest = query({
  args: { headerId: v.id("operationEvidenceHeaders") },
  returns: payloadResult,
  handler: (ctx, args) => hydrate(ctx, args.headerId, "latest"),
});

export const headers = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    ...paginationResultValidator(headerDoc).fields,
    ...readFields,
  }),
  handler: async (ctx, args) => {
    const count = args.paginationOpts.numItems;
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw new Error("Invalid operation evidence page size");
    const page = await ctx.db
      .query("operationEvidenceHeaders")
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 262144,
      });
    return { ...page, ...(await readState(ctx)) };
  },
});

export const resolve = query({
  args: { selector: selectorValidator, value: v.string() },
  returns: headerResult,
  handler: async (ctx, args) => {
    const digest = await selectorDigest(args.selector, args.value);
    const rows =
      args.selector === "operationId"
        ? await ctx.db
            .query("operationEvidenceHeaders")
            .withIndex("by_operation_digest", (q) =>
              q.eq("operationDigest", digest),
            )
            .take(2)
        : await ctx.db
            .query("operationEvidenceHeaders")
            .withIndex("by_source_charge_digest", (q) =>
              q.eq("sourceChargeDigest", digest),
            )
            .take(2);
    const candidate = rows.length === 1 ? rows[0]! : null;
    if (!candidate || !isValidHeader(candidate) || candidate.isContradictory)
      return { header: null, ...(await readState(ctx)) };
    const original = await ctx.db.get(
      "operationEvidencePayloads",
      candidate.originalPayloadId,
    );
    const matches =
      original &&
      original[args.selector] === args.value &&
      (await sourceFingerprint(bodyOf(original))) ===
        candidate.originalFingerprint;
    return { header: matches ? candidate : null, ...(await readState(ctx)) };
  },
});
