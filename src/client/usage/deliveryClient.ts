import { createFunctionHandle, type FunctionReference } from "convex/server";
import { z } from "zod";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  scopeSchema,
  type UsageScope,
  type UsageDeliveryState,
} from "./records.js";
import {
  deliverUsageProvider,
  type UsageDeliveryRequest,
  type UsageDeliveryOutcome,
  type UsageDeliveryProviderOptions,
} from "./deliveryProvider.js";
export type UsageDeliveryRef = { scope: UsageScope; eventId: string };
export type UsageDeliveryStatus = {
  validationErrors: Array<{
    providerEventId: string;
    code: string;
    observedAt: number;
  }>;
  validationHistoryComplete: boolean;
  eventId: string;
  state: UsageDeliveryState;
  attempts: number;
  held: boolean;
  reason?: string;
  providerIdentifier: string;
  receipt?: { identifier: string; created: number };
};
export type UsageDeliveryStartOptions = UsageDeliveryRef & {
  provider: FunctionReference<
    "action",
    "internal",
    UsageDeliveryRequest,
    UsageDeliveryRequest & { outcome: UsageDeliveryOutcome }
  >;
};
function ref(input: UsageDeliveryRef) {
  return {
    scope: scopeSchema.parse(input.scope),
    eventId: z.string().min(1).max(100).parse(input.eventId),
  };
}
export class UsageDeliveryClient {
  constructor(protected readonly component: Component) {}
  async startDelivery(
    ctx: RunCtx,
    opts: UsageDeliveryStartOptions,
  ): Promise<UsageDeliveryStatus> {
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageDelivery/mutations/start"),
      {
        ...ref(opts),
        provider: await createFunctionHandle(opts.provider),
        definitionVersion: 1,
      },
    );
  }
  async startDeliveryBatch(
    ctx: RunCtx,
    opts: {
      scope: UsageScope;
      eventIds: string[];
      provider: UsageDeliveryStartOptions["provider"];
    },
  ) {
    const ids = z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(10)
      .parse(opts.eventIds);
    const results: UsageDeliveryStatus[] = [];
    for (const eventId of ids)
      results.push(
        await this.startDelivery(ctx, {
          scope: opts.scope,
          eventId,
          provider: opts.provider,
        }),
      );
    return results;
  }
  getDelivery(
    ctx: RunCtx,
    input: UsageDeliveryRef,
  ): Promise<UsageDeliveryStatus> {
    return ctx.runQuery(
      componentRef(this.component, "usageDelivery/queries/get"),
      ref(input),
    );
  }
  holdDelivery(
    ctx: RunCtx,
    input: UsageDeliveryRef,
  ): Promise<UsageDeliveryStatus> {
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageDelivery/mutations/hold"),
      ref(input),
    );
  }
  resumeDelivery(
    ctx: RunCtx,
    input: UsageDeliveryRef,
  ): Promise<UsageDeliveryStatus> {
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageDelivery/mutations/resume"),
      ref(input),
    );
  }
  async cancelDelivery(ctx: RunCtx, input: UsageDeliveryRef) {
    await this.getDelivery(ctx, input);
    return {
      status: "unsupported" as const,
      reason: "native_event_cancellation_requires_adjustment" as const,
    };
  }
  deliver(
    ctx: RunCtx,
    input: UsageDeliveryRequest,
    options: UsageDeliveryProviderOptions,
  ) {
    return deliverUsageProvider(this.component, ctx, input, options);
  }
}
