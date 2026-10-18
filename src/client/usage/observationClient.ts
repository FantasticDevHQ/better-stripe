import { readCorrectionEvidence } from "./correctionRead.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import type { UsageDeliveryRef } from "./deliveryClient.js";
import { observeUsageInvoice } from "./invoiceObservation.js";
import Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { StripeApiVersion } from "../stripe-types.js";
import { UsageDeliveryClient } from "./deliveryClient.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
import { observeProviderUsage } from "./providerObservation.js";
import {
  observationOptions,
  observationKeyOptions,
  type UsageObservationOptions,
  type UsageAggregateObservation,
} from "./observationTypes.js";
import type { UsageLocalSummary } from "./summary.js";
import type { UsageScope } from "./records.js";
import { scopeSchema } from "./records.js";
import { validateUsagePageRequest, type UsagePeriod } from "./boundaries.js";
import { compareUsageObservations } from "./reconciliation.js";
export type UsageReconciliationOptions = UsageObservationOptions & {
  maxRecords?: number;
  maxAgeSeconds?: number;
};
/** Host authorizes the exact scope and original binding before every call. */
export class UsageObservationClient extends UsageDeliveryClient {
  async getSummary(
    ctx: RunCtx,
    input: { scope: UsageScope; period: UsagePeriod; maxRecords?: number },
  ): Promise<UsageLocalSummary> {
    const scope = scopeSchema.parse(input.scope),
      { period } = validateUsagePageRequest({
        period: input.period,
        limit: 1,
        cursor: null,
      });
    const json = await ctx.runQuery(
      componentRef(this.component, "usageObservations/queries/summary"),
      { scope, period, maxRecords: input.maxRecords ?? 100 },
    );
    return JSON.parse(json) as UsageLocalSummary;
  }
  async getProviderUsage(
    ctx: RunCtx,
    input: UsageReconciliationOptions,
  ): Promise<UsageAggregateObservation> {
    const opts = observationOptions(input),
      { maxAgeSeconds } = observationKeyOptions.parse({
        maxAgeSeconds: input.maxAgeSeconds,
      });
    const json = await ctx.runQuery(
      componentRef(this.component, "usageObservations/queries/cached"),
      { sourceJson: JSON.stringify(opts) },
    );
    if (json === null)
      return {
        status: "unavailable",
        reason: "provider_not_observed",
        retryable: true,
      };
    const result = JSON.parse(json) as UsageAggregateObservation;
    if (result.status === "available")
      return {
        ...result,
        value: {
          ...result.value,
          stale:
            Math.floor(Date.now() / 1000) - result.observedAt > maxAgeSeconds,
        },
      };
    return result;
  }
  async observeProviderUsage(
    ctx: RunCtx,
    input: UsageObservationOptions,
    options: UsageDeliveryProviderOptions,
  ): Promise<UsageAggregateObservation> {
    const opts = observationOptions(input),
      startedAt = Date.now();
    const observation = options.stripeSecretKey
      ? await observeProviderUsage(
          new Stripe(options.stripeSecretKey, {
            apiVersion: opts.binding.apiVersion as StripeApiVersion,
            maxNetworkRetries: 0,
            timeout: 15000,
            ...(options.httpClient ? { httpClient: options.httpClient } : {}),
          }),
          opts,
        )
      : {
          status: "unavailable" as const,
          reason: "provider_unavailable",
          retryable: true,
        };
    await runMutationOrThrow(
      ctx,
      componentRef(this.component, "usageObservations/mutations/save"),
      {
        sourceJson: JSON.stringify(opts),
        observationJson: JSON.stringify(observation),
        startedAt,
      },
    );
    return observation;
  }
  async readDeliveryHistory(
    ctx: RunCtx,
    input: UsageDeliveryRef & { limit: number; cursor: string | null },
  ) {
    const page = validateUsagePageRequest({
      period: { start: 0, end: 1 },
      limit: input.limit,
      cursor: input.cursor,
    });
    const result = (await ctx.runQuery(
      componentRef(this.component, "usageObservations/queries/deliveryHistory"),
      {
        scope: scopeSchema.parse(input.scope),
        eventId: input.eventId,
        paginationOpts: { numItems: page.limit, cursor: page.cursor },
      },
    )) as {
      page: Doc<"usageDeliveryHistory">[];
      isDone: boolean;
      continueCursor: string;
      legacyHistoryMissing: boolean;
    };
    return {
      records: result.page.map(
        ({ sequence, attempt, phase, recordedAt, created }) => ({
          sequence,
          attempt,
          phase,
          recordedAt,
          created: created ?? null,
        }),
      ),
      isDone: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
      legacyHistoryMissing: result.legacyHistoryMissing,
    };
  }
  async readValidationHistory(
    ctx: RunCtx,
    input: UsageDeliveryRef & { limit: number; cursor: string | null },
  ) {
    const page = validateUsagePageRequest({
      period: { start: 0, end: 1 },
      limit: input.limit,
      cursor: input.cursor,
    });
    const result = (await ctx.runQuery(
      componentRef(
        this.component,
        "usageObservations/queries/validationHistory",
      ),
      {
        scope: scopeSchema.parse(input.scope),
        eventId: input.eventId,
        paginationOpts: { numItems: page.limit, cursor: page.cursor },
      },
    )) as {
      page: Doc<"usageDeliveryErrors">[];
      isDone: boolean;
      continueCursor: string;
    };
    return {
      records: result.page.map(({ providerEventId, code, observedAt }) => ({
        providerEventId,
        code,
        observedAt,
      })),
      isDone: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  }
  async readInvoiceUsage(
    _ctx: RunCtx,
    input: UsageObservationOptions & { invoiceId?: string },
    options: UsageDeliveryProviderOptions,
  ) {
    const opts = observationOptions(input);
    if (!options.stripeSecretKey)
      return {
        status: "unavailable" as const,
        reason: "provider_unavailable",
        retryable: true,
      };
    const stripe = new Stripe(options.stripeSecretKey, {
      apiVersion: opts.binding.apiVersion as StripeApiVersion,
      maxNetworkRetries: 0,
      timeout: 15000,
      ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    });
    return observeUsageInvoice(stripe, opts, input.invoiceId);
  }
  async getReconciliation(ctx: RunCtx, input: UsageReconciliationOptions) {
    const opts = observationOptions(input);
    const [local, aggregate, corrections] = await Promise.all([
      this.getSummary(ctx, {
        scope: opts.scope,
        period: opts.period,
        maxRecords: input.maxRecords,
      }),
      this.getProviderUsage(ctx, input),
      readCorrectionEvidence(this.component, ctx, {
        scope: opts.scope,
        period: opts.period,
        limit: 100,
        cursor: null,
      }),
    ]);
    return {
      local,
      aggregate,
      comparison: compareUsageObservations(local, aggregate, opts.binding),
      invoice: {
        status: "unavailable" as const,
        reason: "invoice_not_observed",
        retryable: true,
      },
      correctionHistory: corrections.records.length
        ? {
            status: "available" as const,
            observedAt: Math.floor(Date.now() / 1000),
            value: corrections,
          }
        : {
            status: "unsupported" as const,
            reason: "corrections_not_configured",
            retryable: false,
            legacyHistoryMissing: corrections.legacyHistoryMissing,
          },
    };
  }
  async reconcile(
    ctx: RunCtx,
    input: UsageReconciliationOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    await this.observeProviderUsage(ctx, input, options);
    return this.getReconciliation(ctx, input);
  }
}
