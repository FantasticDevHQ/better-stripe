import type { SourceHttpClient } from "../paymentSource/resolver.fixtures.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { creditFixture } from "./creditTransport.fixtures.js";
export async function fixture(
  affiliate: { basisPoints?: number; fixedAmount?: number } = {
    basisPoints: 1000,
  },
) {
  const native: Record<string, unknown>[] = [];
  const response = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  const f = creditFixture(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/v1/charges/ch_topup1")
      return response({ id: "ch_topup1", created: 700 });
    if (path !== "/v1/transfers") return;
    if ((init?.method ?? "GET") === "GET")
      return response({ object: "list", data: native, has_more: false });
    const body = new URLSearchParams(String(init?.body ?? ""));
    const transfer = {
      id: `tr_${native.length}`,
      amount: Number(body.get("amount")),
      currency: body.get("currency"),
      destination: body.get("destination"),
      source_transaction: body.get("source_transaction"),
      metadata: {
        bsRole: body.get("metadata[bsRole]"),
        bsSourceCharge: body.get("metadata[bsSourceCharge]"),
      },
    };
    native.push(transfer);
    return response(transfer);
  });
  const client = new BetterStripe(f.component),
    options = {
      stripeSecretKey: "sk_test_credit",
      httpClient: f.httpClient as SourceHttpClient,
    };
  const view = await f.ready();
  await f.t.action((ctx) =>
    client.usage.purchaseCredits(ctx as RunCtx, f.purchase, options),
  );
  f.state.paid = true;
  await f.t.action((ctx) =>
    client.usage.observeCreditPurchase(ctx as RunCtx, f.purchase, options),
  );
  const input = {
    ...f.purchase,
    policy: {
      affiliate: { destinationAccountId: "acct_affiliate", ...affiliate },
    },
  };
  const settle = () =>
    f.t.action((ctx) =>
      client.usage.settleCreditPurchase(ctx as RunCtx, input, options),
    );
  return {
    ...f,
    httpClient: f.httpClient as SourceHttpClient,
    native,
    client,
    options,
    view,
    input,
    settle,
  };
}
