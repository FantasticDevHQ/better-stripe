import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { recordClaim, rollbackClaim } from "./claims.js";
import { reserveGroup, sealGroup } from "./reservations.js";
import { finishGroup } from "./completion.js";
import {
  observationFields,
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
