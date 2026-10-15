import { importOpeningClaim } from "./imports.js";
import { getGroup, integer } from "./helpers.js";
import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { recordClaim, rollbackClaim } from "./claims.js";
import { reserveGroup, sealGroup } from "./reservations.js";
import { finishGroup } from "./completion.js";
import {
  observationFields,
  importArgs,
  claimDoc,
  groupDoc,
  reservationDoc,
  reserveArgs,
  rollbackArgs,
  finishArgs,
} from "./schema.js";
export const record = mutation({
  args: observationFields,
  returns: claimDoc,
  handler: async (ctx, args) => {
    if (args.claimKey.startsWith("rollback:"))
      throw new Error("Rollback claim keys are reserved.");
    return recordClaim(ctx, args);
  },
});
export const rollback = mutation({
  args: rollbackArgs,
  returns: claimDoc,
  handler: rollbackClaim,
});
export const reserve = mutation({
  args: reserveArgs,
  returns: v.object({ reservation: reservationDoc, group: groupDoc }),
  handler: reserveGroup,
});
export const seal = mutation({
  args: { groupKey: v.string() },
  returns: groupDoc,
  handler: sealGroup,
});
export const finish = mutation({
  args: finishArgs,
  returns: v.object({ group: groupDoc, isDone: v.boolean() }),
  handler: finishGroup,
});

export const bindInvoiceItem = mutation({
  args: { groupKey: v.string(), invoiceItemId: v.string() },
  returns: groupDoc,
  handler: async (ctx, args) => {
    const group = await ctx.db
      .query("recoveryGroups")
      .withIndex("by_key", (q) => q.eq("groupKey", args.groupKey))
      .unique();
    if (
      !group ||
      group.sourceKind !== "invoice" ||
      group.status === "open" ||
      group.status === "released" ||
      group.status === "releasing"
    )
      throw new Error("Invoice recovery group must be sealed and active.");
    if (
      !args.invoiceItemId ||
      (group.invoiceItemId && group.invoiceItemId !== args.invoiceItemId)
    )
      throw new Error("Recovery invoice item identity cannot change.");
    await ctx.db.patch("recoveryGroups", group._id, {
      invoiceItemId: args.invoiceItemId,
    });
    return (await ctx.db.get("recoveryGroups", group._id))!;
  },
});

export const bindInvoiceFunding = mutation({
  args: {
    groupKey: v.string(),
    sourceChargeId: v.string(),
    sourceGross: v.number(),
    sourceProcessingFee: v.number(),
  },
  returns: groupDoc,
  handler: async (ctx, args) => {
    const group = await getGroup(ctx, args.groupKey);
    if (group.sourceKind !== "invoice" || group.status !== "collected")
      throw new Error(
        "Invoice funding requires a collected invoice recovery group.",
      );
    integer(args.sourceGross);
    integer(args.sourceProcessingFee);
    if (
      !args.sourceChargeId ||
      args.sourceGross <= 0 ||
      args.sourceProcessingFee < 0
    )
      throw new Error("Invalid invoice funding economics.");
    const funding = {
      sourceChargeId: args.sourceChargeId,
      sourceGross: args.sourceGross,
      sourceProcessingFee: args.sourceProcessingFee,
    };
    if (
      group.invoiceFunding &&
      Object.keys(funding).some(
        (key) =>
          group.invoiceFunding![key as keyof typeof funding] !==
          funding[key as keyof typeof funding],
      )
    )
      throw new Error("Original invoice funding economics cannot change.");
    await ctx.db.patch("recoveryGroups", group._id, {
      invoiceFunding: funding,
    });
    return (await ctx.db.get("recoveryGroups", group._id))!;
  },
});

export const importClaim = mutation({
  args: importArgs,
  returns: claimDoc,
  handler: importOpeningClaim,
});
