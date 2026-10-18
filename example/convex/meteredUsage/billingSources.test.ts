import { expect, it, vi } from "vitest";
import * as sources from "./billingSources";
it("narrows managed subscription scope without leaking meter-only keys", () => {
  expect(
    sources.demoSubscriptionRef({
      scope: {
        stripeAccountId: "acct_issuer",
        customerAccount: "acct_payer",
        livemode: false,
        meterId: "mtr_owned",
      },
      requestId: "original",
    }),
  ).toEqual({
    scope: {
      stripeAccountId: "acct_issuer",
      customerAccount: "acct_payer",
      livemode: false,
    },
    requestId: "original",
  });
});
it("attaches the original test card to its original payer before invoice payment", async () => {
  const attach = vi.fn(async () => ({
    id: "pm_owned",
    livemode: false,
    customer_account: "acct_payer",
  }));
  const raw = { paymentMethods: { attach } };
  await expect(
    sources.attachDemoInvoiceCard(
      raw,
      { id: "pm_owned", livemode: false, customer_account: null },
      "acct_payer",
      "run_owned",
    ),
  ).resolves.toBe("pm_owned");
  expect(attach).toHaveBeenCalledWith(
    "pm_owned",
    { customer_account: "acct_payer" },
    { idempotencyKey: "bs_demo_run_owned_attach_card" },
  );
});
it("rejects foreign or live retained cards without reattaching them", async () => {
  const attach = vi.fn();
  for (const card of [
    { id: "pm_foreign", livemode: false, customer_account: "acct_foreign" },
    { id: "pm_live", livemode: true, customer_account: null },
  ]) {
    await expect(
      sources.attachDemoInvoiceCard(
        { paymentMethods: { attach } },
        card,
        "acct_payer",
        "run_owned",
      ),
    ).rejects.toThrow(/original sandbox payer/i);
  }
  expect(attach).not.toHaveBeenCalled();
});
