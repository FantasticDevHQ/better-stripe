// Test-only Stripe HTTP boundary. Unexpected endpoints fail instead of reaching Stripe.
import Stripe from "stripe";
export const secret = "sk_test_cross_domain_runtime_only";
export const ga = "2026-09-30.endive";
export const preview = "2026-09-30.preview";
export const wire = {
  calls: [] as {
    path: string;
    method: string;
    version: string | null;
    key: string | null;
    authenticated: boolean;
  }[],
  enabled: new Set<string>(),
  attached: new Set<string>(),
  transfers: [] as Record<string, unknown>[],
  items: [] as Record<string, unknown>[],
  refunded: false,
  dispute: "none" as "none" | "lost" | "won",
  invoicePaid: false,
  loseApply: false,
  loseTransfer: false,
  loseCreate: false,
  gate: null as Promise<void> | null,
  transferGate: null as Promise<void> | null,
  projectionFailures: 0,
};
const list = (data: unknown[]) => ({ object: "list", data, has_more: false });
const tx = (id: string, source: string, amount: number, fee: number) => ({
  id,
  object: "balance_transaction",
  source,
  amount,
  fee,
  net: amount - fee,
  currency: "usd",
  created: 1,
  fee_details: [],
});
export function reset() {
  Object.assign(wire, {
    calls: [],
    enabled: new Set(),
    attached: new Set(),
    transfers: [],
    items: [],
    refunded: false,
    dispute: "none",
    invoicePaid: false,
    loseApply: false,
    loseTransfer: false,
    loseCreate: false,
    gate: null,
    transferGate: null,
    projectionFailures: 0,
  });
}
export const fixtureFetch: typeof fetch = async (url, init) => {
  const u = new URL(String(url)),
    path = u.pathname;
  const method = init?.method ?? "GET",
    h = new Headers(init?.headers);
  wire.calls.push({
    path,
    method,
    version: h.get("Stripe-Version"),
    key: h.get("Idempotency-Key"),
    authenticated: h.get("Authorization") === `Bearer ${secret}`,
  });
  const p = new URLSearchParams(String(init?.body ?? ""));
  let body: unknown;
  if (path.includes("/subscriptions/")) {
    const suffix = path.split("_").pop()!;
    if (method === "POST") {
      if (p.get("default_payment_method") === `pm_balance_${suffix}`)
        wire.enabled.add(suffix);
      else wire.enabled.delete(suffix);
      if (wire.loseApply) {
        wire.loseApply = false;
        throw new TypeError("private transport body");
      }
    }
    body = {
      id: `sub_${suffix}`,
      object: "subscription",
      status: "active",
      customer_account: `acct_${suffix}`,
      default_payment_method: wire.enabled.has(suffix)
        ? `pm_balance_${suffix}`
        : `pm_card_${suffix}`,
      payment_settings: {
        payment_method_types: [
          wire.enabled.has(suffix) ? "stripe_balance" : "card",
        ],
      },
    };
  } else if (path.includes("payment_methods")) {
    let suffix = path.split("_").pop()!.split("/")[0];
    if (path.endsWith("/payment_methods")) {
      suffix = "a";
      if (wire.gate) await wire.gate;
      if (wire.loseCreate) {
        wire.loseCreate = false;
        throw new TypeError("private create body");
      }
    }
    if (path.endsWith("/attach")) wire.attached.add(suffix);
    const balance = !path.includes("pm_card_");
    body = {
      id: `pm_${balance ? "balance" : "card"}_${suffix}`,
      object: "payment_method",
      type: balance ? "stripe_balance" : "card",
      customer_account:
        balance && !wire.attached.has(suffix) ? null : `acct_${suffix}`,
    };
  } else if (path.endsWith("/transfers")) {
    if (method === "POST") {
      const transfer = {
        id: `tr_${wire.transfers.length + 1}`,
        object: "transfer",
        amount: Number(p.get("amount")),
        currency: p.get("currency"),
        destination: p.get("destination"),
        source_transaction: p.get("source_transaction"),
        transfer_group: p.get("transfer_group"),
        amount_reversed: 0,
        metadata: {
          bsRole: p.get("metadata[bsRole]"),
          bsSourceCharge: p.get("metadata[bsSourceCharge]"),
        },
      };
      wire.transfers.push(transfer);
      body = transfer;
      if (wire.transferGate) await wire.transferGate;
      if (wire.loseTransfer) {
        wire.loseTransfer = false;
        throw new TypeError("private transfer body");
      }
    } else
      body = list(
        wire.transfers.filter(
          (t) =>
            !u.searchParams.has("transfer_group") ||
            t.transfer_group === u.searchParams.get("transfer_group"),
        ),
      );
  } else if (path.endsWith("/invoiceitems")) {
    if (method === "POST") {
      const item = {
        id: `ii_${wire.items.length + 1}`,
        object: "invoiceitem",
        invoice: p.get("invoice"),
        customer_account: p.get("customer_account"),
        currency: p.get("currency"),
        amount: Number(p.get("amount")),
        discountable: false,
        metadata: { bsRecoveryGroup: p.get("metadata[bsRecoveryGroup]") },
      };
      wire.items.push(item);
      body = item;
    } else
      body = list(
        wire.items.filter((i) => i.invoice === u.searchParams.get("invoice")),
      );
  } else if (path.includes("/payment_intents/")) {
    body = {
      id: "pi_source",
      object: "payment_intent",
      status: "succeeded",
      amount: 1000,
      amount_received: 1000,
      currency: "usd",
      customer_account: "acct_buyer",
      livemode: false,
      metadata: {},
      latest_charge: charge(),
    };
  } else if (path.includes("/charges/")) body = charge();
  else if (path.endsWith("/refunds"))
    body = list(
      wire.refunded
        ? [
            {
              id: "re_source",
              object: "refund",
              amount: 1000,
              status: "succeeded",
              currency: "usd",
              charge: "ch_source",
              payment_intent: "pi_source",
              balance_transaction: tx("txn_refund", "re_source", -1000, 0),
              failure_balance_transaction: null,
            },
          ]
        : [],
    );
  else if (path.endsWith("/disputes"))
    body = list(
      wire.dispute === "none"
        ? []
        : [
            {
              id: "dp_source",
              object: "dispute",
              amount: 600,
              status: wire.dispute,
              currency: "usd",
              charge: "ch_source",
              payment_intent: "pi_source",
              balance_transactions: [
                tx("txn_dispute", "dp_source", -600, 15),
                ...(wire.dispute === "won"
                  ? [tx("txn_dispute_credit", "dp_source", 600, -15)]
                  : []),
              ],
            },
          ],
    );
  else if (path.endsWith("/invoice_payments"))
    body = list([
      {
        id: "inpay_source",
        object: "invoice_payment",
        invoice: "in_original",
        status: "paid",
        currency: "usd",
        amount_paid: 1000,
        amount_requested: 1000,
        livemode: false,
        payment: { type: "payment_intent", payment_intent: "pi_source" },
      },
    ]);
  else if (path.endsWith("/lines"))
    body = list([
      {
        id: "il_original",
        object: "line_item",
        invoice: "in_original",
        currency: "usd",
        amount: 1000,
        quantity: 1,
        livemode: false,
        parent: {
          type: "invoice_item_details",
          invoice_item_details: { proration: false },
        },
        pricing: {
          type: "price_details",
          price_details: { price: "price_original", product: "prod_original" },
        },
      },
    ]);
  else if (path.includes("/invoices/")) {
    const id = path.split("/").pop()!;
    const original = id === "in_original";
    body = {
      id,
      object: "invoice",
      status: original || wire.invoicePaid ? "paid" : "draft",
      currency: "usd",
      amount_paid: original ? 1000 : 0,
      amount_due: original ? 1000 : 0,
      amount_remaining: 0,
      total: original ? 1000 : 0,
      amount_overpaid: 0,
      customer_account: original ? "acct_buyer" : `acct_${id.split("_").pop()}`,
      livemode: false,
    };
  } else throw new Error(`Unexpected fixture endpoint ${method} ${path}`);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
export const httpClient = Stripe.createFetchHttpClient(fixtureFetch);
function charge() {
  return {
    id: "ch_source",
    object: "charge",
    payment_intent: "pi_source",
    amount: 1000,
    amount_captured: 1000,
    currency: "usd",
    paid: true,
    captured: true,
    status: "succeeded",
    amount_refunded: wire.refunded ? 1000 : 0,
    disputed: wire.dispute !== "none",
    livemode: false,
    created: 1,
    balance_transaction: tx("txn_source", "ch_source", 1000, 30),
  };
}
