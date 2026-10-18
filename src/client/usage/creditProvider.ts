import { verifyNativeCreditCapacity } from "./creditCapacity.js";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import {
  creditPurchaseTerms,
  UsageCreditRecoveryError,
  type UsageCreditPurchaseOptions,
  type UsageCreditPurchase,
  type UsageCreditPurchaseTerms,
} from "./creditTerms.js";
import { grantCreditProof } from "./creditProofs.js";
import {
  creditCall,
  creditCreateWindow,
  nativeCustomerId,
  creditRequire,
  discoverCredit,
  paymentIdentity,
  verifiedCreditPayment,
  verifyCreditRealm,
} from "./creditNative.js";
import {
  subscriptionTerms,
  subscriptionView,
  subscriptionEvidence,
} from "./subscriptionTerms.js";
export function creditPurchaseView(
  row: Doc<"usageCreditPurchases">,
): UsageCreditPurchase {
  const terms = creditPurchaseTerms(JSON.parse(row.termsJson));
  return {
    purchaseId: terms.purchaseId,
    state: row.state,
    paymentIntentId: row.paymentIntentId ?? null,
    creditGrantId: row.creditGrantId ?? null,
    quantity: terms.quantity,
    amount: terms.amount,
    currency: terms.binding.plan.rate.currency,
  };
}
const mutation = <T>(
  component: Component,
  ctx: RunCtx,
  name: string,
  args: Record<string, unknown>,
) =>
  runMutationOrThrow(
    ctx,
    componentRef(component, "usageCredits/mutations/" + name),
    args,
  ) as Promise<T>;
async function prepared(
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  const terms = creditPurchaseTerms(input);
  const row = await mutation<Doc<"usageCreditPurchases">>(
    component,
    ctx,
    "preparePurchase",
    { inputJson: JSON.stringify(input) },
  );
  return { row, terms };
}
async function latest(component: Component, ctx: RunCtx, key: string) {
  const row = (await ctx.runQuery(
    componentRef(component, "usageCredits/queries/getByKey"),
    { key },
  )) as Doc<"usageCreditPurchases"> | null;
  creditRequire(row, "Credit purchase unavailable");
  return row;
}
async function originalPayment(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  row: Doc<"usageCreditPurchases">,
  terms: UsageCreditPurchaseTerms,
  allowCreate: boolean,
) {
  let payment: Stripe.PaymentIntent | null = row.paymentIntentId
    ? await stripe.paymentIntents.retrieve(row.paymentIntentId, {
        expand: ["latest_charge"],
      })
    : await discoverCredit(row.key, (cursor) =>
        stripe.paymentIntents.list({
          customer_account: terms.scope.customerAccount,
          limit: 100,
          ...(cursor ? { starting_after: cursor } : {}),
        }),
      );
  if (!payment && allowCreate) {
    creditCreateWindow(row.firstAttemptAt);
    const intent = (await ctx.runQuery(
      componentRef(component, "usageCredits/queries/context"),
      {
        bindingJson: JSON.stringify({
          scope: terms.scope,
          binding: terms.binding,
        }),
      },
    )) as Doc<"usageSubscriptionIntents">;
    const native = await stripe.subscriptions.retrieve(intent.providerId!);
    creditRequire(
      native.id === intent.providerId,
      "Native prepaid enrollment identity mismatch",
    );
    const view = subscriptionView(
      subscriptionEvidence(native),
      subscriptionTerms(JSON.parse(intent.termsJson)),
    );
    creditRequire(
      view.status === "active" && view.collection.method === "send_invoice",
      "Unsupported prepaid collection policy",
    );
    const pending = (await ctx.runQuery(
      componentRef(component, "usageCredits/queries/capacity"),
      {
        bindingJson: JSON.stringify({
          scope: terms.scope,
          binding: terms.binding,
        }),
      },
    )) as number;
    await verifyNativeCreditCapacity(stripe, terms, pending);
    await mutation(component, ctx, "markPaymentAttempt", { key: row.key });
    payment = await stripe.paymentIntents.create(
      {
        customer_account: terms.scope.customerAccount,
        amount: terms.amount,
        currency: terms.binding.plan.rate.currency,
        allowed_payment_method_types: ["card"],
        metadata: { bsUsageCredit: row.key },
      },
      { idempotencyKey: "bs_usage_credit_payment_" + row.key },
    );
  }
  if (!payment) return null;
  paymentIdentity(payment, terms, row.key, row.paymentIntentId);
  await mutation(component, ctx, "pinPayment", {
    key: row.key,
    paymentIntentId: payment.id,
  });
  // Discovery/list returns unexpanded charges. The original pinned ID is always re-read.
  const observed = await stripe.paymentIntents.retrieve(payment.id, {
    expand: ["latest_charge"],
  });
  paymentIdentity(observed, terms, row.key, payment.id);
  return observed;
}
export async function ensureCreditPurchase(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  return creditCall(async () => {
    const { row, terms } = await prepared(component, ctx, input);
    await verifyCreditRealm(stripe, terms);
    const payment = await originalPayment(
      stripe,
      component,
      ctx,
      row,
      terms,
      true,
    );
    creditRequire(payment, "Credit payment identity unavailable");
    return {
      purchase: creditPurchaseView(await latest(component, ctx, row.key)),
      clientSecret: [
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
      ].includes(payment.status)
        ? payment.client_secret
        : null,
    };
  });
}
function grantProof(
  grant: Stripe.Billing.CreditGrant,
  terms: UsageCreditPurchaseTerms,
  key: string,
  payment: NonNullable<ReturnType<typeof verifiedCreditPayment>>,
) {
  const prices = grant.applicability_config.scope.prices;
  creditRequire(
    grant.object === "billing.credit_grant" &&
      grant.customer_account === terms.scope.customerAccount &&
      nativeCustomerId(grant.customer) === terms.binding.stripeCustomerId &&
      grant.livemode === terms.scope.livemode &&
      grant.metadata?.bsUsageCredit === key &&
      grant.category === "paid" &&
      grant.amount.type === "monetary" &&
      grant.amount.monetary?.value === terms.amount &&
      grant.amount.monetary.currency === terms.binding.plan.rate.currency &&
      !grant.voided_at &&
      !grant.applicability_config.scope.price_type &&
      prices?.length === 1 &&
      prices[0].id === terms.binding.stripePriceId &&
      grant.expires_at === (terms.expiresAt ?? null) &&
      grant.priority === 50,
    "Native credit grant provenance mismatch",
  );
  return grantCreditProof.parse({
    ...payment,
    creditGrantId: grant.id,
    stripePriceId: terms.binding.stripePriceId,
    createdAt: grant.created,
    effectiveAt: grant.effective_at,
    expiresAt: grant.expires_at,
  });
}
export async function observeCreditPurchase(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  return creditCall(async () => {
    const { row, terms } = await prepared(component, ctx, input);
    await verifyCreditRealm(stripe, terms, false);
    const payment = await originalPayment(
      stripe,
      component,
      ctx,
      row,
      terms,
      false,
    );
    if (!payment) return creditPurchaseView(row);
    let proof;
    try {
      proof = verifiedCreditPayment(payment, terms);
    } catch (error) {
      if (error instanceof UsageCreditRecoveryError) {
        await mutation(component, ctx, "freezePurchase", {
          key: row.key,
          paymentIntentId: payment.id,
          reason: error.reason,
          refundedAmount:
            typeof payment.latest_charge === "object"
              ? payment.latest_charge?.amount_refunded
              : undefined,
        });
      }
      throw error;
    }
    if (!proof)
      return creditPurchaseView(await latest(component, ctx, row.key));
    await mutation(component, ctx, "verifyPayment", {
      key: row.key,
      proofJson: JSON.stringify(proof),
    });
    let grant = row.creditGrantId
      ? await stripe.billing.creditGrants.retrieve(row.creditGrantId)
      : await discoverCredit(row.key, (cursor) =>
          stripe.billing.creditGrants.list({
            customer_account: terms.scope.customerAccount,
            limit: 100,
            ...(cursor ? { starting_after: cursor } : {}),
          }),
        );
    if (!grant) {
      const grantIntent = await latest(component, ctx, row.key);
      creditCreateWindow(grantIntent.grantFirstAttemptAt!);
      grant = await stripe.billing.creditGrants.create(
        {
          customer_account: terms.scope.customerAccount,
          category: "paid",
          priority: 50,
          amount: {
            type: "monetary",
            monetary: {
              currency: terms.binding.plan.rate.currency,
              value: terms.amount,
            },
          },
          applicability_config: {
            scope: { prices: [{ id: terms.binding.stripePriceId }] },
          },
          metadata: { bsUsageCredit: row.key },
          ...(terms.expiresAt === undefined
            ? {}
            : { expires_at: terms.expiresAt }),
        },
        { idempotencyKey: "bs_usage_credit_grant_" + row.key },
      );
    }
    creditRequire(
      !row.creditGrantId || grant.id === row.creditGrantId,
      "Native credit grant identity mismatch",
    );
    const nativeProof = grantProof(grant, terms, row.key, proof);
    await mutation(component, ctx, "pinGrant", {
      key: row.key,
      proofJson: JSON.stringify(nativeProof),
    });
    return creditPurchaseView(await latest(component, ctx, row.key));
  });
}
