import { managedBillingPolicy } from "../usageSubscriptions/acceptance.js";
import { subscriptionSnapshot } from "../usage/helpers.js";
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
  returns: v.object({
    event: eventDoc,
    outbox: outboxDoc,
    billingCutoff: v.union(v.number(), v.null()),
    managedCollection: v.union(
      v.null(),
      v.object({
        method: v.union(
          v.literal("send_invoice"),
          v.literal("charge_automatically"),
        ),
        daysUntilDue: v.union(v.number(), v.null()),
        defaultPaymentMethod: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (
    ctx: import("../_generated/server.js").QueryCtx,
    args: import("convex/values").Infer<typeof _refValidator>,
  ) => {
    const { event, outbox, record } = await read(ctx, args);
    const policy = await managedBillingPolicy(
      ctx,
      record,
      subscriptionSnapshot(event.subscriptionJson),
    );
    return {
      event,
      outbox,
      billingCutoff: policy?.cutoff ?? null,
      managedCollection: policy?.collection ?? null,
    };
  },
};
const _refValidator = v.object(refFields);
export const saved = internalQuery(snapshotDefinition);
export const snapshot = query(snapshotDefinition);
