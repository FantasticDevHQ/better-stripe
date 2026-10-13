import { v } from "convex/values";
import {
  action,
  internalAction,
  type ActionCtx,
  env,
} from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import { assertTestModeStripeKey } from "./authz";
import { getStripeClient } from "./lib/stripeClient";
import { stripe } from "./stripe";
import { hasPaidStorePlan } from "./lib/storePlans";
import {
  SANDBOX_SALES,
  SANDBOX_REFUNDS,
  SANDBOX_DISPUTES,
  FIXTURE_SELLERS,
  fixtureKey,
} from "./lib/sandboxFixturePlan";

const TASKS = [
  { kind: "plans" as const },
  { kind: "catalog" as const },
  ...SANDBOX_SALES.map((_, index) => ({ kind: "sale" as const, index })),
  ...SANDBOX_REFUNDS.map((_, index) => ({ kind: "refund" as const, index })),
  ...SANDBOX_DISPUTES.map((_, index) => ({
    kind: "disputeSale" as const,
    index,
  })),
  ...SANDBOX_DISPUTES.map((_, index) => ({
    kind: "disputeOutcome" as const,
    index,
  })),
  { kind: "subscription" as const },
  ...["maya@example.com", "sasha@example.com", "avery@example.com"].map(
    (email) => ({ kind: "payout" as const, email }),
  ),
];
async function ensure<T extends { id: string }>(
  ctx: ActionCtx,
  key: string,
  kind: string,
  retrieve: (id: string) => Promise<T>,
  recover: () => Promise<T | undefined>,
  create: () => Promise<T>,
): Promise<T> {
  const saved = await ctx.runQuery(internal.sandboxFixtureState.resource, {
    key,
  });
  if (saved) return retrieve(saved);
  const resource = (await recover()) ?? (await create());
  await ctx.runMutation(internal.sandboxFixtureState.saveResource, {
    key,
    stripeId: resource.id,
    kind,
  });
  return resource;
}
async function participants(ctx: ActionCtx) {
  const users = await ctx.runQuery(api.users.list, {});
  const customer = users.find((u) => u.role === "customer");
  const affiliate = users.find((u) => u.role === "affiliate");
  const sellers = FIXTURE_SELLERS.map((email) =>
    users.find((u) => u.email === email),
  );
  if (
    !customer?.stripeAccountId ||
    !affiliate?.stripeAccountId ||
    sellers.some((s) => !s?.stripeAccountId)
  )
    throw new Error("Seed demo users and linked Stripe accounts first.");
  return { customer, affiliate, sellers: sellers.map((s) => s!) };
}
async function fixturePayment(
  ctx: ActionCtx,
  email: string,
  scenario: string,
  amount: number,
  paymentMethod: string,
  referred: boolean,
) {
  const raw = getStripeClient();
  const { sellers, customer, affiliate } = await participants(ctx);
  const seller = sellers.find((s) => s.email === email)!;
  const key = fixtureKey(seller.stripeAccountId!, scenario);
  const payment = await ensure(
    ctx,
    key,
    "payment",
    (id) => raw.paymentIntents.retrieve(id),
    async () =>
      (
        await raw.paymentIntents.search({
          query: `metadata['fixtureKey']:'${key}'`,
          limit: 1,
        })
      ).data[0],
    () =>
      raw.paymentIntents.create(
        {
          amount,
          currency: "usd",
          customer_account: customer.stripeAccountId,
          payment_method: paymentMethod,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
          description: `BetterStripe example ${scenario}`,
          metadata: {
            fixtureKey: key,
            storeBilling: "sale_v1",
            sellerId: seller._id,
            userId: customer._id,
            planId: seller.storePlan?.planId ?? "starter",
            affiliateAccountId: referred ? affiliate.stripeAccountId! : "",
            referralCode: referred ? "avery" : "",
            productName:
              email === "jordan@example.com"
                ? "Classic Tee"
                : (seller.storeName ?? seller.name),
          },
        },
        { idempotencyKey: key },
      ),
  );
  await ctx.runAction(internal.storeSaleSettlement.settle, {
    paymentIntentId: payment.id,
  });
  return { payment, seller, key };
}

export const start = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const { sellers } = await participants(ctx);
    // The hosted-onboarding persona may have completed onboarding since its
    // account was created. Receiving marketplace funds needs recipient too.
    const jordan = sellers[0];
    const account = await stripe.getAccountByStripeId(ctx, {
      stripeAccountId: jordan.stripeAccountId!,
    });
    if (
      account?.onboardingStatus === "complete" &&
      !account.appliedConfigurations?.includes("recipient")
    )
      await stripe.addRecipientConfiguration(ctx, {
        stripeAccountId: jordan.stripeAccountId!,
      });
    const interrupted = await ctx.runQuery(
      internal.sandboxFixtureState.resource,
      { key: fixtureKey(jordan.stripeAccountId!, "sale:0") },
    );
    if (interrupted) {
      const raw = getStripeClient();
      const payment = await raw.paymentIntents.retrieve(interrupted, {
        expand: ["latest_charge"],
      });
      const charge = payment.latest_charge;
      if (charge && typeof charge !== "string") {
        const sale = await ctx.runQuery(
          internal.storeSaleSettlement.getByCharge,
          { chargeId: charge.id },
        );
        if (
          sale?.status === "pending" &&
          !sale.sellerTransferId &&
          !sale.affiliateTransferId
        ) {
          if (!charge.refunded)
            await raw.refunds.create(
              {
                payment_intent: payment.id,
                metadata: { fixtureKey: "interrupted-onboarding-fixture" },
              },
              { idempotencyKey: `${payment.id}:unready-fixture-refund` },
            );
          await ctx.runMutation(
            internal.storeSaleSettlement.markUnpaidSaleRefunded,
            { chargeId: charge.id },
          );
        }
      }
    }
    const job = await ctx.runMutation(internal.sandboxFixtureState.begin, {
      total: TASKS.length,
    });
    if (job)
      await ctx.scheduler.runAfter(0, internal.sandboxFixtures.step, job);
    return null;
  },
});
export const step = internalAction({
  args: { jobId: v.id("sandboxFixtureJobs"), cursor: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const job = await ctx.runQuery(internal.sandboxFixtureState.getJob, {
      jobId: args.jobId,
    });
    if (!job || job.status !== "running" || job.cursor !== args.cursor)
      return null;
    try {
      const task = TASKS[args.cursor];
      const raw = getStripeClient();
      const { sellers, customer, affiliate } = await participants(ctx);
      if (task.kind === "plans") {
        const catalog = await ctx.runAction(
          internal.storePlanActions.ensureCatalog,
          {},
        );
        for (const [index, seller] of sellers.entries()) {
          if (hasPaidStorePlan(seller.storePlan)) continue;
          await stripe.addCustomerConfiguration(ctx, {
            stripeAccountId: seller.stripeAccountId!,
          });
          const existing = (
            await raw.subscriptions.list({
              customer_account: seller.stripeAccountId,
              status: "all",
              limit: 100,
            })
          ).data.find(
            (s) =>
              s.metadata.storeBilling === "plan_v1" &&
              s.status !== "canceled" &&
              s.status !== "incomplete_expired",
          );
          let subscription = existing;
          if (!subscription) {
            const method = await raw.paymentMethods.attach(
              "pm_card_visa",
              { customer_account: seller.stripeAccountId },
              {
                idempotencyKey: fixtureKey(
                  seller.stripeAccountId!,
                  "plan-card",
                ),
              },
            );
            const planId = (["pro", "starter", "growth"] as const)[index];
            const key = fixtureKey(seller.stripeAccountId!, "store-plan");
            subscription = await raw.subscriptions.create(
              {
                customer_account: seller.stripeAccountId,
                items: [
                  {
                    price: catalog.find((p) => p.planId === planId)!
                      .stripePriceId,
                  },
                ],
                default_payment_method: method.id,
                payment_behavior: "error_if_incomplete",
                metadata: {
                  fixtureKey: key,
                  storeBilling: "plan_v1",
                  sellerId: seller._id,
                  userId: seller._id,
                  planId,
                },
              },
              { idempotencyKey: key },
            );
          }
          await ctx.runAction(internal.storePlanActions.refreshSubscription, {
            subscriptionId: subscription.id,
          });
        }
      } else if (task.kind === "catalog") {
        const seller = sellers[0];
        const key = fixtureKey(seller.stripeAccountId!, "tee-product");
        const product = await ensure(
          ctx,
          key,
          "product",
          (id) =>
            raw.products.retrieve(id).then((p) => {
              if (p.deleted)
                throw new Error("Fixture product was deleted in Stripe.");
              return p;
            }),
          async () =>
            (
              await raw.products.search({
                query: `metadata['fixtureKey']:'${key}'`,
                limit: 1,
              })
            ).data[0],
          () =>
            raw.products.create(
              {
                name: "Classic Tee",
                description: "A premium cotton tee from Jordan's store",
                metadata: {
                  fixtureKey: key,
                  storeAccountId: seller.stripeAccountId!,
                  storeName: seller.name,
                },
              },
              { idempotencyKey: key },
            ),
        );
        await ctx.runMutation(
          components.betterStripe.products.mutations.upsertProduct,
          {
            stripeProductId: product.id,
            accountId: seller.stripeAccountId,
            name: product.name,
            description: product.description ?? undefined,
            active: product.active,
            metadata: product.metadata,
          },
        );
        for (const recurring of [false, true]) {
          const lookupKey = `${key}:${recurring ? "monthly" : "once"}`;
          const price =
            (await raw.prices.list({ lookup_keys: [lookupKey], limit: 1 }))
              .data[0] ??
            (await raw.prices.create(
              {
                product: product.id,
                unit_amount: recurring ? 1900 : 2900,
                currency: "usd",
                ...(recurring
                  ? { recurring: { interval: "month" as const } }
                  : {}),
                lookup_key: lookupKey,
                metadata: { storeAccountId: seller.stripeAccountId! },
              },
              { idempotencyKey: lookupKey },
            ));
          await ctx.runMutation(
            components.betterStripe.products.mutations.upsertPrice,
            {
              stripePriceId: price.id,
              productId: (await stripe.getProductByStripeId(ctx, {
                stripeProductId: product.id,
              }))!._id,
              stripeProductId: product.id,
              active: price.active,
              unitAmount: price.unit_amount!,
              currency: price.currency,
              type: recurring ? "recurring" : "one_time",
              interval: recurring ? "month" : undefined,
              intervalCount: price.recurring?.interval_count,
              metadata: price.metadata,
            },
          );
        }
      } else if (task.kind === "sale") {
        const sale = SANDBOX_SALES[task.index];
        await fixturePayment(
          ctx,
          sale.sellerEmail,
          sale.key,
          sale.amount,
          sale.paymentMethod,
          sale.referred,
        );
      } else if (task.kind === "refund") {
        const refund = SANDBOX_REFUNDS[task.index];
        const sale = SANDBOX_SALES[refund.saleIndex];
        const seller = sellers.find((s) => s.email === sale.sellerEmail)!;
        const paymentId = await ctx.runQuery(
          internal.sandboxFixtureState.resource,
          { key: fixtureKey(seller.stripeAccountId!, sale.key) },
        );
        if (!paymentId) throw new Error("The fixture sale is not ready yet.");
        const key = fixtureKey(seller.stripeAccountId!, `refund:${task.index}`);
        await ensure(
          ctx,
          key,
          "refund",
          (id) => raw.refunds.retrieve(id),
          async () =>
            (
              await raw.refunds.list({ payment_intent: paymentId, limit: 100 })
            ).data.find((r) => r.metadata?.fixtureKey === key),
          () =>
            raw.refunds.create(
              {
                payment_intent: paymentId,
                amount: refund.amount,
                reason: "requested_by_customer",
                metadata: { fixtureKey: key },
              },
              { idempotencyKey: key },
            ),
        );
      } else if (task.kind === "disputeSale") {
        const dispute = SANDBOX_DISPUTES[task.index];
        await fixturePayment(
          ctx,
          dispute.sellerEmail,
          `dispute:${dispute.key}`,
          10000,
          dispute.paymentMethod,
          true,
        );
      } else if (task.kind === "disputeOutcome") {
        const fixture = SANDBOX_DISPUTES[task.index];
        const seller = sellers.find((s) => s.email === fixture.sellerEmail)!;
        const paymentId = await ctx.runQuery(
          internal.sandboxFixtureState.resource,
          {
            key: fixtureKey(seller.stripeAccountId!, `dispute:${fixture.key}`),
          },
        );
        if (!paymentId)
          throw new Error("The disputed payment is not ready yet.");
        const dispute = (
          await raw.disputes.list({ payment_intent: paymentId, limit: 10 })
        ).data[0];
        if (!dispute)
          throw new Error("Stripe's test dispute is not ready yet.");
        const chargeId =
          typeof dispute.charge === "string"
            ? dispute.charge
            : dispute.charge.id;
        // The test card can emit its dispute before the sale's transfers exist.
        // Reconcile any remaining reversal after settlement with the same primitive.
        if (dispute.status !== "won")
          await stripe.reverseTransfers(ctx, {
            sourceChargeId: chargeId,
            amount: dispute.amount,
            operationId: `${dispute.id}:fixture-settlement`,
          });
        if (
          fixture.outcome !== "open" &&
          !["won", "lost"].includes(dispute.status)
        )
          await raw.disputes.update(
            dispute.id,
            {
              evidence: {
                uncategorized_text:
                  fixture.outcome === "won"
                    ? "winning_evidence"
                    : "losing_evidence",
              },
              submit: true,
            },
            {
              idempotencyKey: fixtureKey(
                seller.stripeAccountId!,
                `outcome:${fixture.key}`,
              ),
            },
          );
      } else if (task.kind === "subscription") {
        const seller = sellers[1];
        const products = await stripe.listProducts(ctx, {
          accountId: seller.stripeAccountId,
        });
        const prices = await stripe.listPricesByProduct(ctx, {
          stripeProductId: products[0].stripeProductId,
        });
        const price = prices.find(
          (p) => p.type === "recurring" && p.interval === "month",
        );
        if (!price) throw new Error("Seed the monthly seller product first.");
        const key = fixtureKey(customer.stripeAccountId!, "customer-monthly");
        const method = await raw.paymentMethods.attach(
          "pm_card_visa",
          { customer_account: customer.stripeAccountId },
          { idempotencyKey: `${key}:card` },
        );
        await ensure(
          ctx,
          key,
          "subscription",
          (id) => raw.subscriptions.retrieve(id),
          async () =>
            (
              await raw.subscriptions.list({
                customer_account: customer.stripeAccountId,
                status: "all",
                limit: 100,
              })
            ).data.find((s) => s.metadata.fixtureKey === key),
          () =>
            raw.subscriptions.create(
              {
                customer_account: customer.stripeAccountId,
                items: [{ price: price.stripePriceId }],
                default_payment_method: method.id,
                payment_behavior: "error_if_incomplete",
                metadata: {
                  fixtureKey: key,
                  storeBilling: "sale_v1",
                  sellerId: seller._id,
                  userId: customer._id,
                  planId: seller.storePlan!.planId,
                  affiliateAccountId: affiliate.stripeAccountId!,
                  referralCode: "avery",
                },
              },
              { idempotencyKey: key },
            ),
        );
      } else if (task.kind === "payout") {
        const user =
          task.email === affiliate.email
            ? affiliate
            : sellers.find((s) => s.email === task.email)!;
        const accountId = user.stripeAccountId!;
        const key = fixtureKey(accountId, "payout");
        const banks = await raw.accounts.listExternalAccounts(accountId, {
          object: "bank_account",
          limit: 10,
        });
        if (!banks.data.length)
          await raw.accounts.createExternalAccount(
            accountId,
            {
              external_account: "btok_us_verified",
              default_for_currency: true,
            },
            { idempotencyKey: `${key}:bank` },
          );
        const payout = await ensure(
          ctx,
          key,
          "payout",
          (id) => raw.payouts.retrieve(id, {}, { stripeAccount: accountId }),
          async () =>
            (
              await raw.payouts.list(
                { limit: 100 },
                { stripeAccount: accountId },
              )
            ).data.find((p) => p.metadata?.fixtureKey === key),
          () =>
            raw.payouts.create(
              {
                amount: task.email === affiliate.email ? 500 : 1000,
                currency: "usd",
                metadata: { fixtureKey: key, accountId },
              },
              { stripeAccount: accountId, idempotencyKey: key },
            ),
        );
        await ctx.runMutation(
          components.betterStripe.connect.mutations.upsertPayout,
          {
            stripePayoutId: payout.id,
            accountId,
            amount: payout.amount,
            currency: payout.currency,
            status: payout.status as
              "pending" | "paid" | "failed" | "canceled" | "in_transit",
            arrivalDate: new Date(payout.arrival_date * 1000).toISOString(),
            method: payout.method,
            metadata: payout.metadata,
          },
        );
      }
      if (task.kind === "payout") {
        const user =
          task.email === affiliate.email
            ? affiliate
            : sellers.find((seller) => seller.email === task.email)!;
        const payoutId = await ctx.runQuery(
          internal.sandboxFixtureState.resource,
          { key: fixtureKey(user.stripeAccountId!, "payout") },
        );
        if (payoutId)
          await ctx.scheduler.runAfter(
            15000,
            internal.sandboxFixtures.refreshPayout,
            { accountId: user.stripeAccountId!, payoutId },
          );
      }
      if (args.cursor === TASKS.length - 1)
        await ctx.runAction(internal.sellerCostActions.reconcileExisting, {});
      const more = await ctx.runMutation(
        internal.sandboxFixtureState.advance,
        args,
      );
      if (more)
        await ctx.scheduler.runAfter(500, internal.sandboxFixtures.step, {
          ...args,
          cursor: args.cursor + 1,
        });
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).split("\n")[0];
      const retry =
        job.attempts < 12 &&
        /not ready|not available yet|balance_insufficient|insufficient available|rate limit|temporarily/i.test(
          message,
        );
      await ctx.runMutation(internal.sandboxFixtureState.failure, {
        ...args,
        error: message,
        retry,
      });
      if (retry)
        await ctx.scheduler.runAfter(5000, internal.sandboxFixtures.step, args);
    }
    return null;
  },
});

/** Mirror the real sandbox payout status while Stripe finishes processing it. */
export const refreshPayout = internalAction({
  args: {
    accountId: v.string(),
    payoutId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const payout = await getStripeClient().payouts.retrieve(
      args.payoutId,
      {},
      { stripeAccount: args.accountId },
    );
    await ctx.runMutation(
      components.betterStripe.connect.mutations.upsertPayout,
      {
        stripePayoutId: payout.id,
        accountId: args.accountId,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status as
          "pending" | "paid" | "failed" | "canceled" | "in_transit",
        arrivalDate: new Date(payout.arrival_date * 1000).toISOString(),
        method: payout.method,
        metadata: payout.metadata,
      },
    );
    const attempt = args.attempt ?? 0;
    if (["pending", "in_transit"].includes(payout.status) && attempt < 20)
      await ctx.scheduler.runAfter(
        15000,
        internal.sandboxFixtures.refreshPayout,
        { ...args, attempt: attempt + 1 },
      );
    return null;
  },
});

export const refreshExistingPayouts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const users = await ctx.runQuery(api.users.list, {});
    for (const user of users.filter(
      (user) => user.role === "seller" || user.role === "affiliate",
    )) {
      if (!user.stripeAccountId) continue;
      const id = await ctx.runQuery(internal.sandboxFixtureState.resource, {
        key: fixtureKey(user.stripeAccountId, "payout"),
      });
      if (id)
        await ctx.runAction(internal.sandboxFixtures.refreshPayout, {
          accountId: user.stripeAccountId,
          payoutId: id,
        });
    }
    return null;
  },
});
