import { UsageObservationClient } from "./observationClient.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  validateUsageRecordInput,
  type PreparedUsageRecord,
  type UsageScope,
  type UsageDeliveryState,
} from "./records.js";
import {
  validateUsagePageRequest,
  type UsagePageRequest,
  type UsageSubscriptionBinding,
  type UsageReceipt,
} from "./boundaries.js";
import type { Doc, Id } from "../../component/_generated/dataModel.js";
import type { FunctionHandle } from "convex/server";
export type RecordUsageOptions = {
  event: unknown;
  subscription: UsageSubscriptionBinding;
  reservationId?: Id<"usageReservations">;
  dispatch?: FunctionHandle<"action">;
  quota?: number;
};
export type UsageEventView = {
  receipt: UsageReceipt;
  record: PreparedUsageRecord;
  subscription: UsageSubscriptionBinding;
  delivery: UsageDeliveryState;
};
type StoredView = { event: Doc<"usageEvents">; delivery: UsageDeliveryState };
function decode({ event, delivery }: StoredView): UsageEventView {
  return {
    receipt: {
      eventId: event._id,
      identity: event.identity,
      acceptedAt: event.acceptedAt,
      delivery: "queued",
    },
    record: JSON.parse(event.recordJson) as PreparedUsageRecord,
    subscription: JSON.parse(
      event.subscriptionJson,
    ) as UsageSubscriptionBinding,
    delivery,
  };
}
/** Trusted host facade. Authenticate and authorize each exact scope first. */
export class UsageLedgerClient extends UsageObservationClient {
  constructor(component: Component) {
    super(component);
  }
  async record(ctx: RunCtx, opts: RecordUsageOptions): Promise<UsageReceipt> {
    const event = validateUsageRecordInput(opts.event);
    const input = {
      scope: event.scope,
      binding: event.binding,
      sourceEventId: event.sourceEventId,
      quantity: event.quantity,
      occurredAt: event.occurredAt,
    };
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usage/mutations/record"),
      {
        inputJson: JSON.stringify(input),
        subscriptionJson: JSON.stringify(opts.subscription),
        dispatch: opts.dispatch,
        reservationId: opts.reservationId,
        quota: opts.quota,
      },
    );
  }
  async get(
    ctx: RunCtx,
    opts: { scope: UsageScope; eventId: string },
  ): Promise<UsageEventView | null> {
    const result = (await ctx.runQuery(
      componentRef(this.component, "usage/queries/get"),
      opts,
    )) as StoredView | null;
    return result ? decode(result) : null;
  }
  async read(ctx: RunCtx, opts: { scope: UsageScope; page: UsagePageRequest }) {
    const page = validateUsagePageRequest(opts.page);
    const result = (await ctx.runQuery(
      componentRef(this.component, "usage/queries/read"),
      {
        scope: opts.scope,
        period: page.period,
        paginationOpts: { numItems: page.limit, cursor: page.cursor },
      },
    )) as { page: StoredView[]; continueCursor: string; isDone: boolean };
    return {
      events: result.page.map(decode),
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  }
}
