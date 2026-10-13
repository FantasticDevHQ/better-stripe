import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { FIXTURE_SELLERS, fixtureKey } from "./sandboxFixturePlan";
import { canReceiveStorePayments } from "./storeRecipient";
import { getStripeClient } from "./stripeClient";

export async function ensure<T extends { id: string }>(
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
export async function participants(ctx: ActionCtx) {
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
export async function fixturePayment(
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
  const recipients = [
    seller.stripeAccountId!,
    ...(referred ? [affiliate.stripeAccountId!] : []),
  ];
  for (const id of recipients) {
    const account = await raw.v2.core.accounts.retrieve(id, {
      include: ["configuration.recipient"],
    });
    if (!canReceiveStorePayments(account))
      throw new Error(
        "Test recipient transfers are not ready yet. Waiting for Stripe verification.",
      );
  }
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
