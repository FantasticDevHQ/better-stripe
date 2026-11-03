import Stripe from "stripe";

export const apiVersion = "2026-09-30.endive";

// Never copy provider messages: they can contain credentials or customer data.
export function failure(error) {
  return {
    status: "fail",
    type: String(error.type ?? "Error"),
    code: String(error.code ?? "unknown"),
    httpStatus: error.statusCode ?? null,
  };
}

export async function probeCapabilities(
  key,
  createClient = (value) =>
    new Stripe(value, { apiVersion, maxNetworkRetries: 0, timeout: 15000 }),
) {
  if (!/^(?:sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(key ?? ""))
    throw new Error("Only a sandbox test key is permitted");
  const stripe = createClient(key);
  const results = {};
  const resources = {};
  const check = async (name, operation) => {
    try {
      const value = await operation();
      if (value.livemode === true) throw new Error("Live object refused");
      resources[name] = value;
      results[name] = { status: "pass" };
    } catch (error) {
      results[name] = failure(error);
    }
  };
  await check("account", () => stripe.accounts.retrieve());
  await check("accountsV2", () =>
    stripe.v2.core.accounts.create({
      display_name: "BTS-327 capability probe",
      identity: { country: "us" },
      configuration: { customer: {} },
    }),
  );
  await check("connect", () =>
    stripe.v2.core.accounts.create({
      display_name: "BTS-327 recipient probe",
      identity: { country: "us" },
      dashboard: "none",
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
    }),
  );
  await check("customer", () =>
    stripe.customers.create({
      name: "BTS-327 billing probe",
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    }),
  );
  await check("checkout", () =>
    stripe.checkout.sessions.create({
      mode: "payment",
      success_url: "https://example.com/success",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 100,
            product_data: { name: "BTS-327 checkout probe" },
          },
        },
      ],
    }),
  );
  await check("price", () =>
    stripe.prices.create({
      currency: "usd",
      unit_amount: 100,
      recurring: { interval: "month" },
      product_data: { name: "BTS-327 subscription probe" },
    }),
  );
  for (const [name, dependencies, operation] of [
    [
      "subscription",
      ["customer", "price"],
      () =>
        stripe.subscriptions.create({
          customer: resources.customer.id,
          items: [{ price: resources.price.id }],
        }),
    ],
    [
      "transfer",
      ["connect"],
      () =>
        stripe.transfers.create({
          amount: 1,
          currency: "usd",
          destination: resources.connect.id,
        }),
    ],
  ]) {
    if (dependencies.every((dep) => results[dep].status === "pass"))
      await check(name, operation);
    else results[name] = { status: "blocked", dependencies };
  }
  // A real test-mode payout request: capability or balance rejection is a failure,
  // not evidence that payouts are supported.
  await check("payout", () =>
    stripe.payouts.create({ amount: 1, currency: "usd" }),
  );
  await check("snapshotTrigger", () =>
    stripe.products.create({
      name: "BTS-327 signed event probe",
    }),
  );
  const cleanup = {};
  for (const [name, operation] of [
    [
      "subscription",
      () => stripe.subscriptions.cancel(resources.subscription.id),
    ],
    ["checkout", () => stripe.checkout.sessions.expire(resources.checkout.id)],
    ["transfer", () => stripe.transfers.createReversal(resources.transfer.id)],
    ["payout", () => stripe.payouts.cancel(resources.payout.id)],
    [
      "snapshotTrigger",
      () =>
        stripe.products.update(resources.snapshotTrigger.id, { active: false }),
    ],
  ]) {
    if (!resources[name]) continue;
    try {
      await operation();
      cleanup[name] = { status: "pass" };
    } catch (error) {
      cleanup[name] = failure(error);
    }
  }
  return {
    apiVersion,
    keyType: key.split("_")[0],
    results,
    cleanup,
    existingAdminGuardAcceptsKey: /^[rs]k_test_/.test(key),
    // Do not export object IDs, response bodies, keys or hosted checkout URLs.
  };
}
