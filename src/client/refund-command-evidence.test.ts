// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";

import schema from "../component/schema.js";
import { BetterStripe, type RefundCommandEvidenceOptions } from "./index.js";
import type { RunCtx } from "./helpers.js";
import { components, initConvexTest } from "./setup.test.js";

const modules = import.meta.glob("../component/**/*.ts");
const opts: RefundCommandEvidenceOptions = {
  commandKey: "dojo-refund:original_command:v1",
  stripeAccountId: "acct_original",
  stripePaymentIntentId: "pi_original",
  stripeChargeId: "ch_original",
  currency: "jpy",
};
function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  const client = new BetterStripe(components.betterStripe, {});
  return { t, ctx, client };
}

it("exposes actual component correlation through public BetterStripe without Stripe credentials", async () => {
  const f = fixture();
  await f.t.mutation(components.betterStripe.connect.mutations.upsertRefund, {
    stripeRefundId: "re_original",
    accountId: opts.stripeAccountId,
    stripePaymentIntentId: opts.stripePaymentIntentId,
    stripeChargeId: opts.stripeChargeId,
    amount: 500,
    currency: "jpy",
    status: "succeeded",
    metadata: { betterStripeRefundCommand: opts.commandKey },
  });
  expect(await f.client.getRefundCommandEvidence(f.ctx, opts)).toMatchObject({
    status: "observed",
    refund: { stripeRefundId: "re_original", amount: 500, currency: "jpy" },
  });
});

it.each([
  undefined,
  null,
  {},
  { ...opts, commandKey: "" },
  { ...opts, commandKey: " x".repeat(100) },
  { ...opts, commandKey: "x".repeat(201) },
  { ...opts, commandKey: 123 },
  { ...opts, stripeAccountId: "cus_wrong" },
  { ...opts, stripePaymentIntentId: "pi_" },
  { ...opts, stripeChargeId: "ch_wrong space" },
  { ...opts, currency: "USD" },
  { ...opts, actor: { type: "admin" } },
])(
  "rejects malformed public selectors %# before component reads",
  async (options) => {
    const f = fixture();
    const runQuery = vi.fn();
    const read = f.client.getRefundCommandEvidence.bind(f.client) as (
      ctx: RunCtx,
      opts: unknown,
    ) => Promise<unknown>;
    await expect(read({ runQuery } as RunCtx, options)).rejects.toThrow();
    expect(runQuery).not.toHaveBeenCalled();
  },
);
