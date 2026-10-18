import { z } from "zod";
import type { RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { UsageCreditClient } from "./creditClient.js";
import { prepareUsageRecord, scopeSchema, type UsageScope } from "./records.js";
import {
  allowanceBinding,
  limitPolicy,
  type UsageAllowanceBinding,
  type UsageAllowanceStatus,
  type UsageAllowanceReconciliation,
  type UsageLimitPolicy,
} from "./allowanceTerms.js";
import type { UsageSubscriptionBinding } from "./boundaries.js";
import type { Doc, Id } from "../../component/_generated/dataModel.js";
export type UsageAllowanceReservation =
  | { state: "denied"; reason: "not_entitled" | "hard_limit"; revision: number }
  | {
      state: "reserved" | "committed" | "released";
      reservationId: Id<"usageReservations">;
      revision: number;
    };
const bindingJson = (input: UsageAllowanceBinding) =>
  JSON.stringify(
    allowanceBinding({
      scope: input.scope,
      binding: input.binding,
      subscription: input.subscription,
    }),
  );
/** Trusted host authorizes policy management and the exact billable activity. */
export class UsageAllowanceClient extends UsageCreditClient {
  configureAllowance(
    ctx: RunCtx,
    input: UsageAllowanceBinding & {
      policy: UsageLimitPolicy;
      expectedRevision: number;
    },
  ): Promise<{ revision: number }> {
    const binding = allowanceBinding({
      scope: input.scope,
      binding: input.binding,
      subscription: input.subscription,
    });
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageAllowance/mutations/configure"),
      {
        bindingJson: JSON.stringify(binding),
        policyJson: JSON.stringify(limitPolicy(input.policy, binding)),
        expectedRevision: input.expectedRevision,
      },
    );
  }
  async getAllowanceStatus(
    ctx: RunCtx,
    input: UsageAllowanceBinding,
  ): Promise<UsageAllowanceStatus | null> {
    const result = (await ctx.runQuery(
      componentRef(this.component, "usageAllowance/queries/status"),
      { bindingJson: bindingJson(input) },
    )) as string | null;
    return result === null
      ? null
      : (JSON.parse(result) as UsageAllowanceStatus);
  }
  reconcileAllowance(
    ctx: RunCtx,
    input: UsageAllowanceBinding,
  ): Promise<UsageAllowanceReconciliation> {
    return ctx.runQuery(
      componentRef(this.component, "usageAllowance/queries/reconciliation"),
      { bindingJson: bindingJson(input) },
    );
  }
  reserveAllowance(
    ctx: RunCtx,
    input: { event: unknown; subscription: UsageSubscriptionBinding },
  ): Promise<UsageAllowanceReservation> {
    const event = prepareUsageRecord(input.event);
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageAllowance/mutations/reserve"),
      {
        inputJson: JSON.stringify({
          scope: event.scope,
          binding: event.binding,
          sourceEventId: event.sourceEventId,
          occurredAt: event.occurredAt,
          quantity: event.quantity,
        }),
        subscriptionJson: JSON.stringify(input.subscription),
      },
    );
  }
  releaseAllowance(
    ctx: RunCtx,
    input: {
      scope: UsageScope;
      reservationId: Id<"usageReservations">;
      reason: "work_failed" | "abandoned_before_work";
    },
  ) {
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageAllowance/mutations/release"),
      { ...input, scope: scopeSchema.parse(input.scope) },
    );
  }
  async readAllowanceHistory(
    ctx: RunCtx,
    input: UsageAllowanceBinding & { limit: number; cursor: string | null },
  ) {
    const limit = z.number().int().min(1).max(100).parse(input.limit),
      cursor = z.string().min(1).max(2048).nullable().parse(input.cursor);
    const result = (await ctx.runQuery(
      componentRef(this.component, "usageAllowance/queries/readHistory"),
      {
        bindingJson: bindingJson(input),
        paginationOpts: { numItems: limit, cursor },
      },
    )) as {
      page: Doc<"usageAllowanceHistory">[];
      continueCursor: string;
      isDone: boolean;
    };
    return {
      records: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  }
}
