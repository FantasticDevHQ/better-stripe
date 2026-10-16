import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import {
  assertOwner,
  assertSelector,
  ownerGeneration,
  physicalSource,
  registrationByKey,
  sameOwner,
} from "./helpers.js";
import { ownerFields, registrationResult, sourceValidator } from "./schema.js";

/** Trusted host-server provenance. Authenticate and verify logical source ownership before calling. */
export const register = mutation({
  args: {
    bucketKey: v.string(),
    kind: v.union(v.literal("stripe_account"), v.literal("logical")),
    ...ownerFields,
    source: v.optional(sourceValidator),
  },
  returns: registrationResult,
  handler: async (ctx, args) => {
    assertOwner(args);
    assertSelector(args.bucketKey);
    if (args.kind === "logical") {
      if (!args.source)
        throw new Error("Trusted logical ownership source is required");
      assertSelector(args.source.integration);
      assertSelector(args.source.recordId);
    } else if (args.source !== undefined)
      throw new Error("Physical ownership proof is component-owned");
    const existing = await registrationByKey(ctx, args.bucketKey);
    if (existing) {
      if (
        !sameOwner(existing, args) ||
        existing.kind !== args.kind ||
        (args.kind === "logical" &&
          (existing.source.integration !== args.source!.integration ||
            existing.source.recordId !== args.source!.recordId))
      )
        throw new Error("Financial ownership is immutable");
      return {
        status: "registered" as const,
        coverage: "unknown" as const,
        registration: existing,
      };
    }
    const source =
      args.kind === "logical"
        ? args.source!
        : await physicalSource(ctx, args.bucketKey, args);
    const prior = await ownerGeneration(ctx, args);
    const generation = (prior?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation))
      throw new Error("Financial ownership generation overflow");
    const owner = {
      userId: args.userId,
      ...(args.orgId === undefined ? {} : { orgId: args.orgId }),
    };
    if (prior)
      await ctx.db.patch("financialOwnershipGenerations", prior._id, {
        generation,
      });
    else
      await ctx.db.insert("financialOwnershipGenerations", {
        ...owner,
        generation,
      });
    const id = await ctx.db.insert("financialOwnership", {
      bucketKey: args.bucketKey,
      kind: args.kind,
      ...owner,
      source,
      generation,
    });
    const registration = (await ctx.db.get("financialOwnership", id))!;
    return {
      status: "registered" as const,
      coverage: "unknown" as const,
      registration,
    };
  },
});
