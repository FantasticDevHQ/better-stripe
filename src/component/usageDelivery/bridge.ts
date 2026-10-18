import { anyApi, type FunctionHandle } from "convex/server";
import { internalAction } from "../_generated/server.js";
import { request } from "./schema.js";
import { outcome } from "./fields.js";
import type { Infer } from "convex/values";
import { z } from "zod";
const accepted = z.strictObject({
  status: z.literal("accepted"),
  created: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const parsedOutcome = z.union([
  accepted,
  z.strictObject({
    status: z.enum(["rate_limited", "unavailable", "unknown", "rejected"]),
  }),
]);
export const invoke = internalAction({
  args: request,
  returns: outcome,
  handler: async (ctx, args): Promise<Infer<typeof outcome>> => {
    try {
      const { outbox } = await ctx.runQuery(
        anyApi.usageDelivery.queries.saved,
        { scope: args.scope, eventId: args.eventId },
      );
      if (outbox.held) return { status: "unavailable" };
      if (
        !outbox.provider ||
        outbox.attempts !== args.attempt ||
        outbox.state !== "sending" ||
        outbox.providerIdentifier !== args.identifier
      )
        return { status: "unknown" };
      const raw: unknown = await ctx.runAction(
        outbox.provider as FunctionHandle<"action">,
        args,
      );
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return { status: "unknown" };
      const result = raw as Record<string, unknown>;
      if (
        Object.keys(result).length !== Object.keys(args).length + 1 ||
        Object.keys(args).some(
          (key) =>
            JSON.stringify(result[key]) !==
            JSON.stringify(args[key as keyof typeof args]),
        )
      )
        return { status: "unknown" };
      const validated = parsedOutcome.safeParse(result.outcome);
      return validated.success ? validated.data : { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  },
});
