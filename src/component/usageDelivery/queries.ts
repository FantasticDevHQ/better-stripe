import { query, internalQuery } from "../_generated/server.js";
import { refFields, status } from "./schema.js";
import { read, currentStatus } from "./helpers.js";
import { v } from "convex/values";
import { eventDoc, outboxDoc } from "../usage/schema.js";
export const get = query({
  args: refFields,
  returns: status,
  handler: async (ctx, args) =>
    currentStatus(ctx, (await read(ctx, args)).outbox),
});
const snapshotDefinition = {
  args: refFields,
  returns: v.object({ event: eventDoc, outbox: outboxDoc }),
  handler: async (
    ctx: import("../_generated/server.js").QueryCtx,
    args: import("convex/values").Infer<typeof _refValidator>,
  ) => {
    const { event, outbox } = await read(ctx, args);
    return { event, outbox };
  },
};
const _refValidator = v.object(refFields);
export const saved = internalQuery(snapshotDefinition);
export const snapshot = query(snapshotDefinition);
