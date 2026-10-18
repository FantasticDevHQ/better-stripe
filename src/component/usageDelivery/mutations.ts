import { appendDeliveryHistory } from "../usageObservations/history.js";
import { errorCode } from "./fields.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
import { mutation } from "../_generated/server.js";
import { anyApi, type FunctionReference } from "convex/server";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { refFields, status } from "./schema.js";
import { read, currentStatus } from "./helpers.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
const workflow = anyApi.usageDelivery.workflow.run as FunctionReference<
  "mutation",
  "internal"
>;
async function launch(
  ctx: MutationCtx,
  args: import("convex/values").Infer<typeof _refValidator>,
  outbox: Doc<"usageOutbox">,
) {
  if (outbox.workflowId) {
    const state = await executionWorkflow.status(
      ctx,
      outbox.workflowId as WorkflowId,
    );
    if (state.type === "inProgress") return;
    if (state.type === "failed") {
      const last = (
        await executionWorkflow.listSteps(
          ctx,
          outbox.workflowId as WorkflowId,
          { order: "desc", paginationOpts: { cursor: null, numItems: 1 } },
        )
      ).page[0];
      if (last?.name === "save-receipt" && last.runResult?.kind === "failed") {
        await executionWorkflow.restart(ctx, outbox.workflowId as WorkflowId, {
          from: last.stepNumber,
          startAsync: true,
        });
        return;
      }
    }
  }
  const workflowId = await executionWorkflow.start(ctx, workflow, args, {
    startAsync: true,
  });
  await ctx.db.patch("usageOutbox", outbox._id, { workflowId });
}
const _refValidator = v.object(refFields);
export const start = mutation({
  args: { ...refFields, provider: v.string(), definitionVersion: v.literal(1) },
  returns: status,
  handler: async (ctx, args) => {
    const { outbox } = await read(ctx, args);
    if (!args.provider.startsWith("function://") || args.provider.length > 2048)
      throw new Error("Internal provider handle required");
    if (outbox.provider && outbox.provider !== args.provider)
      throw new Error("Usage provider binding is immutable");
    if (!outbox.provider)
      await ctx.db.patch("usageOutbox", outbox._id, {
        provider: args.provider,
        definitionVersion: 1,
      });
    if (
      ![
        "canceled",
        "provider_accepted",
        "rejected",
        "unknown",
        "held",
      ].includes(outbox.state)
    )
      await launch(ctx, { scope: args.scope, eventId: args.eventId }, outbox);
    return await currentStatus(ctx, (await read(ctx, args)).outbox);
  },
});
export const hold = mutation({
  args: refFields,
  returns: status,
  handler: async (ctx, args) => {
    const { outbox } = await read(ctx, args);
    await ctx.db.patch("usageOutbox", outbox._id, {
      held: true,
      ...(outbox.state === "queued"
        ? { state: "held" as const, reason: "administrative_hold" as const }
        : {}),
    });
    if (!outbox.held)
      await appendDeliveryHistory(
        ctx,
        args.eventId,
        "held",
        outbox.attempts,
        `control:${(outbox.historySequence ?? 0) + 1}:held`,
      );
    return await currentStatus(ctx, (await read(ctx, args)).outbox);
  },
});
export const resume = mutation({
  args: refFields,
  returns: status,
  handler: async (ctx, args) => {
    const { outbox } = await read(ctx, args);
    if (outbox.correctionKey) return await currentStatus(ctx, outbox);
    if (
      outbox.state === "unknown" ||
      ["provider_accepted", "rejected"].includes(outbox.state) ||
      outbox.reason === "delivery_window_expired"
    ) {
      if (outbox.held) {
        await ctx.db.patch("usageOutbox", outbox._id, { held: false });
        await appendDeliveryHistory(
          ctx,
          args.eventId,
          "resumed",
          outbox.attempts,
          `control:${(outbox.historySequence ?? 0) + 1}:resumed`,
        );
      }
      return await currentStatus(ctx, (await read(ctx, args)).outbox);
    }
    if (!outbox.provider)
      throw new Error("Start delivery with a host provider first");
    await ctx.db.patch("usageOutbox", outbox._id, {
      held: false,
      state: outbox.state === "sending" ? "sending" : "queued",
      reason: undefined,
    });
    if (outbox.held || outbox.state === "held")
      await appendDeliveryHistory(
        ctx,
        args.eventId,
        "resumed",
        outbox.attempts,
        `control:${(outbox.historySequence ?? 0) + 1}:resumed`,
      );
    await launch(ctx, args, outbox);
    return await currentStatus(ctx, (await read(ctx, args)).outbox);
  },
});

/** Only a verified host webhook/provider action may submit native reports. */
export const recordErrorReport = mutation({
  args: {
    stripeAccountId: v.string(),
    livemode: v.boolean(),
    providerEventId: v.string(),
    meterId: v.optional(v.string()),
    samples: v.array(v.object({ identifier: v.string(), code: errorCode })),
    truncated: v.boolean(),
  },
  returns: v.object({
    matched: v.number(),
    unattributed: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (
      args.samples.length > 100 ||
      !/^evt_[a-zA-Z0-9_]+$/.test(args.providerEventId) ||
      args.providerEventId.length > 100 ||
      !/^acct_[a-zA-Z0-9]+$/.test(args.stripeAccountId)
    )
      throw new Error("Invalid usage error report");
    let matched = 0,
      unattributed = 0;
    for (const sample of args.samples) {
      if (sample.identifier.length > 100)
        throw new Error("Invalid usage error identifier");
      const outbox = await ctx.db
        .query("usageOutbox")
        .withIndex("by_provider_identifier", (q) =>
          q.eq("providerIdentifier", sample.identifier),
        )
        .unique();
      const event = outbox
        ? await ctx.db.get("usageEvents", outbox.eventId)
        : null;
      const record = event
        ? (JSON.parse(event.recordJson) as PreparedUsageRecord)
        : null;
      if (
        !event ||
        !record ||
        record.scope.stripeAccountId !== args.stripeAccountId ||
        record.scope.livemode !== args.livemode ||
        (args.meterId !== undefined && record.scope.meterId !== args.meterId)
      ) {
        unattributed++;
        continue;
      }
      const dedupe = JSON.stringify([
        args.providerEventId,
        event._id,
        sample.code,
      ]);
      const prior = await ctx.db
        .query("usageDeliveryErrors")
        .withIndex("by_dedupe", (q) => q.eq("dedupe", dedupe))
        .unique();
      if (!prior)
        await ctx.db.insert("usageDeliveryErrors", {
          dedupe,
          scopeKey: event.scopeKey,
          eventId: event._id,
          providerEventId: args.providerEventId,
          code: sample.code,
          observedAt: Math.floor(Date.now() / 1000),
        });
      matched++;
    }
    return { matched, unattributed, truncated: args.truncated };
  },
});
