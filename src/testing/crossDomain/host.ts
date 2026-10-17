import {
  anyApi,
  componentsGeneric,
  internalActionGeneric as action,
  internalMutationGeneric as mutation,
} from "convex/server";
import { v } from "convex/values";
import { BetterStripe } from "../../client/index.js";
import type { Component } from "../../client/helpers.js";
import { scopeFields } from "../../component/costRecovery/schema.js";
import { httpClient, secret, ga, preview, wire } from "./transport.js";
const nested = componentsGeneric().betterStripe;
const sdk = () =>
  new BetterStripe(nested as unknown as Component, {
    STRIPE_SECRET_KEY: secret,
    stripeApiVersion: preview,
  });
const recovery = () => sdk().costRecovery;
export const scope = (name = "a") => ({
  accountId: `acct_${name}`,
  scopeKey: `cost:${name}`,
  currency: "usd",
});
export const fundingScope = (name = "a") => ({
  accountId: `acct_${name}`,
  scopeKey: `funding:${name}`,
  stripeSubscriptionId: `sub_${name}`,
});
const ref = { ...scopeFields, operationId: v.string(), version: v.number() };
const groupRef = { ...ref, groupKey: v.string() };
const phase = {
  accountId: v.string(),
  scopeKey: v.string(),
  operationId: v.string(),
  version: v.number(),
  stripeSubscriptionId: v.string(),
  providerApiVersion: v.string(),
  definitionVersion: v.string(),
  phase: v.union(v.literal("create"), v.literal("attach"), v.literal("apply")),
  providerKey: v.string(),
};
const groupArgs = {
  name: v.string(),
  kind: v.union(v.literal("invoice"), v.literal("settlement")),
};
export const host = {
  fundingControl: action({
    args: {
      operationId: v.string(),
      version: v.number(),
      command: v.union(v.literal("resume"), v.literal("cancel")),
    },
    returns: v.any(),
    handler: (ctx, { command, ...op }) =>
      sdk().balanceFundingWorkflow[command](ctx, { ...fundingScope(), ...op }),
  }),
  funding: action({
    args: { requestKey: v.string() },
    returns: v.any(),
    handler: (ctx, args) =>
      sdk().balanceFundingWorkflow.prepare(ctx, {
        ...fundingScope(),
        ...args,
        consent: true,
        consentAt: 123,
        consentReference: "original-consent",
        providerAction: anyApi.host.fundingProvider,
      }),
  }),
  apply: action({
    args: {
      preparationId: v.string(),
      enabled: v.boolean(),
      requestKey: v.string(),
    },
    returns: v.any(),
    handler: (ctx, args) =>
      sdk().balanceFundingWorkflow.apply(ctx, {
        ...fundingScope(),
        ...args,
        ...(args.enabled ? { consent: true as const } : {}),
        providerAction: anyApi.host.fundingProvider,
      }),
  }),
  fundingProvider: action({
    args: phase,
    returns: v.any(),
    handler: (ctx, args) =>
      sdk().balanceFundingWorkflow.executeProviderPhase(ctx, args),
  }),
  prepareRecovery: mutation({
    args: { ...groupArgs, amount: v.number() },
    returns: v.any(),
    handler: async (ctx, args) => {
      const s = scope(args.name);
      await recovery().recordClaim(ctx, {
        ...s,
        claimKey: `debt:${args.name}`,
        sourceChargeId: `ch_debt_${args.name}`,
        sourceGross: 1000,
        sourceProcessingFee: 30,
        amountDue: args.amount,
        revision: 0,
      });
      return recovery().prepareGroup(ctx, {
        ...s,
        groupKey: `${args.kind}:${args.name}`,
        ...(args.kind === "settlement"
          ? {
              sourceKind: "settlement" as const,
              sourceId: "ch_source",
              sourceGross: 1000,
              sourceProcessingFee: 30,
            }
          : { sourceKind: "invoice" as const, sourceId: `in_${args.name}` }),
        maxDebit: 1000,
        maxCredit: 1000,
      });
    },
  }),
  startRecovery: mutation({
    args: {
      ...groupArgs,
      requestKey: v.string(),
      affiliate: v.optional(v.boolean()),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
      const s = scope(args.name),
        groupKey = `${args.kind}:${args.name}`;
      const group = await recovery().getGroup(ctx, { groupKey });
      return recovery().startGroup(ctx, {
        ...s,
        groupKey,
        requestKey: args.requestKey,
        provider: anyApi.host.recoveryProvider,
        completion: anyApi.host.recoveryProjection,
        providerApiVersion: ga,
        definitionVersion: 1,
        releaseUncollectible: false,
        maxAttempts: 2,
        retryDelayMs: 1,
        ...(args.kind === "settlement"
          ? {
              allocation: {
                sourceChargeId: "ch_source",
                paymentIntentId: "pi_source",
                sourceInvoiceId: "in_original",
                gross: 1000,
                currency: "usd",
                processingFee: 30,
                platformNet: 70,
                adjustmentAmount: group!.amount,
                transfers: [
                  {
                    destinationAccountId: s.accountId,
                    role: "store" as const,
                    amount: 900 - group!.amount - (args.affiliate ? 100 : 0),
                  },
                  ...(args.affiliate
                    ? [
                        {
                          destinationAccountId: "acct_affiliate",
                          role: "affiliate" as const,
                          amount: 100,
                        },
                      ]
                    : []),
                ],
              },
            }
          : {}),
      });
    },
  }),
  recoveryProvider: action({
    args: {
      ...groupRef,
      phase: v.union(v.literal("execute"), v.literal("reconcile")),
      providerApiVersion: v.string(),
      definitionVersion: v.number(),
    },
    returns: v.any(),
    handler: (ctx, args) =>
      recovery().executeGroupProvider(ctx, args, {
        stripeSecretKey: secret,
        httpClient,
      }),
  }),
  recoveryProjection: mutation({
    args: {
      ...groupRef,
      sourceKind: v.string(),
      sourceId: v.string(),
      status: v.string(),
      cancelRequested: v.boolean(),
      outcome: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      const prior = await ctx.db
        .query("reports")
        .withIndex("by_operation", (q) => q.eq("operationId", args.operationId))
        .unique();
      if (!prior)
        await ctx.db.insert("reports", {
          domain: "recovery",
          operationId: args.operationId,
          version: args.version,
          amount: 0,
        });
      if (wire.projectionFailures > 0) {
        wire.projectionFailures--;
        throw new Error("private database projection");
      }
      return null;
    },
  }),
  costs: mutation({
    args: {
      requestKey: v.string(),
      expectedRevision: v.number(),
      rollback: v.optional(
        v.object({ groupKey: v.string(), expectedRevision: v.number() }),
      ),
    },
    returns: v.any(),
    handler: (ctx, args) =>
      recovery().startProcessingCostReconciliation(ctx, {
        ...scope(),
        ...args,
        claimKey: "cost:pi_source",
        source: {
          kind: "sale",
          paymentIntentId: "pi_source",
          gross: 1000,
          customerAccountId: "acct_buyer",
          invoiceId: "in_original",
        },
        policy: {
          sellingFee: 100,
          liability: { processingCosts: "uncovered", disputeCosts: "all" },
          rounding: "nearest",
        },
        provider: anyApi.host.costProvider,
        projection: anyApi.host.costProjection,
        providerApiVersion: ga,
        definitionVersion: 1,
        maxAttempts: 2,
        retryDelayMs: 1,
      }),
  }),
  costProvider: action({
    args: {
      ...ref,
      providerApiVersion: v.string(),
      definitionVersion: v.number(),
    },
    returns: v.any(),
    handler: (ctx, args) =>
      recovery().observeProcessingCosts(ctx, args, {
        stripeSecretKey: secret,
        httpClient,
      }),
  }),
  costProjection: mutation({
    args: { ...ref, status: v.literal("completed"), result: v.any() },
    returns: v.null(),
    handler: async (ctx, args) => {
      const prior = await ctx.db
        .query("reports")
        .withIndex("by_operation", (q) => q.eq("operationId", args.operationId))
        .unique();
      if (!prior)
        await ctx.db.insert("reports", {
          domain: "cost",
          operationId: args.operationId,
          version: args.version,
          amount: args.result.claim.amountDue,
        });
      if (wire.projectionFailures > 0) {
        wire.projectionFailures--;
        throw new Error("private cost projection");
      }
      return null;
    },
  }),
};
