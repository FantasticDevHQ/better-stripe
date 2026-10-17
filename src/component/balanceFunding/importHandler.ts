import { validateOriginal } from "./helpers.js";
import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { text, integer, validateScope, fingerprint } from "./helpers.js";
import { importPreparationArgs } from "./mutationValidators.js";
export async function importPreparationHandler(
  ctx: MutationCtx,
  args: Infer<typeof importPreparationArgs>,
) {
  validateScope(args);
  text(args.sourceKey);
  text(args.consentReference);
  text(args.providerApiVersion);
  integer(args.consentAt);
  integer(args.operationVersion, args.pending ? 1 : 0);
  validateOriginal(args.preparation);
  text(args.preparation.stripeSubscriptionId);
  if (args.preparation.paymentMethodId) text(args.preparation.paymentMethodId);
  else if (args.pending?.kind !== "prepare")
    throw new Error("Invalid legacy preparation state.");
  if (
    args.pending?.kind === "prepare" &&
    (args.enabled || args.pending.enabled)
  )
    throw new Error("Invalid legacy preparation target.");
  if (args.accountId !== args.preparation.customerAccount)
    throw new Error("Legacy preparation account identity conflict.");
  const requestKey = `import:${args.sourceKey}`;
  const payload = fingerprint(args);
  const prior = await ctx.db
    .query("balanceFundingRequests")
    .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
    .unique();
  if (prior) {
    if (prior.payload !== payload || !prior.imported)
      throw new Error("Legacy import identity conflict.");
    return prior.imported;
  }
  const existing = await ctx.db
    .query("balanceFundingPreparations")
    .withIndex("by_account_subscription", (q) =>
      q
        .eq("accountId", args.accountId)
        .eq(
          "preparation.stripeSubscriptionId",
          args.preparation.stripeSubscriptionId,
        ),
    )
    .unique();
  if (existing)
    throw new Error("Existing preparation cannot be overwritten by import.");
  const preparationId = await ctx.db.insert("balanceFundingPreparations", {
    accountId: args.accountId,
    scopeKey: args.scopeKey,
    preparation: args.preparation,
    consentAt: args.consentAt,
    consentReference: args.consentReference,
    providerApiVersion: args.providerApiVersion,
    enabled: args.enabled,
    operationVersion: args.operationVersion,
    startsPaused: true,
    verified: args.pending?.kind !== "prepare",
  });
  let operation;
  if (args.pending) {
    text(args.pending.providerKey);
    text(args.pending.requestKey);
    const collision = await ctx.db
      .query("balanceFundingRequests")
      .withIndex("by_request", (q) =>
        q.eq("requestKey", args.pending!.requestKey),
      )
      .unique();
    if (collision || args.pending.requestKey === requestKey)
      throw new Error("Legacy operation request identity conflict.");
    const operationId = await ctx.db.insert("balanceFundingOperations", {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      preparationId,
      enabled: args.pending.enabled,
      version: args.operationVersion,
      state: "unknown",
      kind: args.pending.kind ?? "apply",
      providerKey: args.pending.providerKey,
      cancelRequested: false,
      providerKeys: {
        enable: `${args.pending.providerKey}:enable`,
        disable: `${args.pending.providerKey}:disable`,
        ...(args.pending.kind === "prepare"
          ? {
              create: `${args.pending.providerKey}:create`,
              attach: `${args.pending.providerKey}:attach`,
            }
          : {}),
      },
    });
    operation = {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      operationId,
      version: args.operationVersion,
    };
    await ctx.db.patch("balanceFundingPreparations", preparationId, {
      activeOperationId: operationId,
    });
    await ctx.db.insert("balanceFundingRequests", {
      requestKey: args.pending.requestKey,
      preparationId,
      payload:
        args.pending.kind === "prepare"
          ? fingerprint({
              accountId: args.accountId,
              scopeKey: args.scopeKey,
              preparation: {
                customerAccount: args.preparation.customerAccount,
                stripeSubscriptionId: args.preparation.stripeSubscriptionId,
                previousPaymentMethodId:
                  args.preparation.previousPaymentMethodId,
                previousPaymentMethodTypes:
                  args.preparation.previousPaymentMethodTypes,
              },
              consent: true,
              consentAt: args.consentAt,
              consentReference: args.consentReference,
              providerApiVersion: args.providerApiVersion,
              requestKey: args.pending.requestKey,
            })
          : fingerprint({
              accountId: args.accountId,
              scopeKey: args.scopeKey,
              preparationId,
              enabled: args.pending.enabled,
              consent: args.pending.enabled ? true : null,
            }),
      result: { status: "accepted", operation },
    });
  }
  const imported = { preparationId, ...(operation ? { operation } : {}) };
  await ctx.db.insert("balanceFundingRequests", {
    requestKey,
    payload,
    preparationId,
    imported,
  });
  return imported;
}
