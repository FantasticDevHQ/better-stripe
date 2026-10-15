import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { getRecipientPayoutReceipt } from "./payoutReceipt.js";
const scope = { accountId: "acct_recipient", stripePayoutId: "po_one" };
const timestamp = Math.floor(Date.now() / 1000) - 10;
const payout = (extra = {}) => ({
  id: "po_one",
  object: "payout",
  amount: 1000,
  currency: "usd",
  status: "paid",
  automatic: false,
  method: "standard",
  type: "bank_account",
  source_type: "card",
  balance_transaction: "txn_debit",
  failure_balance_transaction: null,
  reversed_by: null,
  destination: "ba_one",
  created: timestamp,
  arrival_date: timestamp + 86400,
  metadata: {},
  ...extra,
});
const transaction = (extra = {}) => ({
  id: "txn_debit",
  source: "po_one",
  amount: -1000,
  fee: 0,
  net: -1000,
  currency: "usd",
  status: "available",
  available_on: timestamp,
  created: timestamp,
  type: "payout",
  ...extra,
});
function setup(extra = {}, debit = {}, credit = {}) {
  const provider = {
    payouts: { retrieve: vi.fn().mockResolvedValue(payout(extra)) },
    balanceTransactions: {
      retrieve: vi.fn(async (id: string) =>
        id === "txn_debit"
          ? transaction(debit)
          : transaction({
              id: "txn_return",
              amount: 1000,
              net: 1000,
              type: "payout_failure",
              ...credit,
            }),
      ),
    },
  };
  return {
    provider,
    read: (options = scope) =>
      getRecipientPayoutReceipt(provider as unknown as Stripe, options),
  };
}
it("verifies a paid manual bank payout against its actual scoped debit", async () => {
  const { provider, read } = setup();
  expect(await read()).toMatchObject({
    status: "ready",
    ...scope,
    amount: 1000,
    currency: "usd",
    providerStatus: "paid",
    automatic: false,
    returnedPrincipal: 0,
    returnedNet: 0,
    debit: { id: "txn_debit", amount: -1000, net: -1000, fee: 0 },
  });
  expect(provider.payouts.retrieve).toHaveBeenNthCalledWith(
    1,
    "po_one",
    {},
    { stripeAccount: scope.accountId },
  );
  expect(provider.balanceTransactions.retrieve).toHaveBeenCalledWith(
    "txn_debit",
    {},
    { stripeAccount: scope.accountId },
  );
  expect(provider.payouts.retrieve).toHaveBeenCalledTimes(2);
});
it("reads automatic history without pretending it identifies per-source allocations", async () => {
  const { read } = setup({ automatic: true });
  expect(await read()).toMatchObject({
    status: "ready",
    automatic: true,
    returnedPrincipal: 0,
  });
});
it.each(["pending", "in_transit"])(
  "preserves %s without saying the bank was paid",
  async (status) => {
    expect(await setup({ status }).read()).toMatchObject({
      status: "ready",
      providerStatus: status,
    });
  },
);
it.each(["failed", "canceled"])(
  "verifies exact principal and signed fees returned after a %s payout",
  async (status) => {
    const result = await setup(
      { status, failure_balance_transaction: "txn_return" },
      { fee: 30, net: -1030 },
      {
        type: status === "failed" ? "payout_failure" : "payout_cancel",
        fee: -10,
        net: 1010,
      },
    ).read();
    expect(result).toMatchObject({
      status: "ready",
      providerStatus: status,
      returnedPrincipal: 1000,
      returnedNet: 1010,
      debit: { fee: 30 },
      credit: { id: "txn_return", fee: -10, net: 1010 },
    });
  },
);
it("does not release a failure without a return receipt", async () => {
  expect(await setup({ status: "failed" }).read()).toEqual({
    status: "not_ready",
    ...scope,
    reason: "return_unavailable",
  });
});
it.each([{ status: "pending" }, { available_on: timestamp + 86400 }])(
  "does not release an immature return (%j)",
  async (credit) => {
    const result = await setup(
      { status: "failed", failure_balance_transaction: "txn_return" },
      {},
      credit,
    ).read();
    expect(result).toEqual({
      status: "not_ready",
      ...scope,
      reason: "return_pending",
    });
    expect(result).not.toHaveProperty("amount");
  },
);
it("preserves a non-refundable payout fee separately from returned principal", async () => {
  expect(
    await setup(
      { status: "failed", failure_balance_transaction: "txn_return" },
      { fee: 30, net: -1030 },
    ).read(),
  ).toMatchObject({
    status: "ready",
    returnedPrincipal: 1000,
    returnedNet: 1000,
    debit: { fee: 30 },
    credit: { fee: 0 },
  });
});
it("fails closed when the provider changes the payout during receipt reads", async () => {
  const { provider, read } = setup();
  provider.payouts.retrieve
    .mockResolvedValueOnce(payout())
    .mockResolvedValueOnce(payout({ status: "failed" }));
  expect(await read()).toEqual({
    status: "not_ready",
    ...scope,
    reason: "provider_changed",
  });
});
it("does not allocate a reversed bank payout as a failed payout", async () => {
  expect(await setup({ reversed_by: "po_reversal" }).read()).toEqual({
    status: "not_ready",
    ...scope,
    reason: "reversal_allocation_required",
  });
});
it("fails closed when settlement currencies differ", async () => {
  expect(await setup({}, { currency: "eur" }).read()).toEqual({
    status: "not_ready",
    ...scope,
    reason: "currency_allocation_required",
  });
});
it.each([
  { id: "txn_other" },
  { source: "po_other" },
  { amount: -999, net: -999 },
  { net: -1001 },
  { amount: -1000.1 },
  { fee: NaN },
  { type: "charge" },
])("rejects mismatched or unsafe payout debit %j", async (debit) => {
  await expect(setup({}, debit).read()).rejects.toThrow(/receipt|integer/);
});
it.each([
  { source: "po_other" },
  { amount: 999, net: 999 },
  { amount: 1001, net: 1001 },
  { net: 999 },
  { type: "charge" },
  { id: "txn_debit" },
])("rejects mismatched payout return %j", async (credit) => {
  await expect(
    setup(
      { status: "failed", failure_balance_transaction: "txn_return" },
      {},
      credit,
    ).read(),
  ).rejects.toThrow(/receipt|integer/);
});
it("does not trust expanded receipt objects without retrieving their scoped records", async () => {
  const { provider, read } = setup({
    balance_transaction: { id: "txn_debit", amount: -5000 },
  });
  expect(await read()).toMatchObject({
    status: "ready",
    debit: { amount: -1000 },
  });
  expect(provider.balanceTransactions.retrieve).toHaveBeenCalledTimes(1);
});
it("binds recovery to the expected durable claim marker when requested", async () => {
  const { provider } = setup({ metadata: { bsPayoutClaim: "claim-1" } });
  const read = (operationKey: string) =>
    getRecipientPayoutReceipt(provider as unknown as Stripe, {
      ...scope,
      operationKey,
    });
  expect(await read("claim-1")).toMatchObject({
    status: "ready",
    operationKey: "claim-1",
  });
  await expect(read("other")).rejects.toThrow(/claim/);
});
it("detects claim marker drift on the final payout read", async () => {
  const { provider } = setup();
  provider.payouts.retrieve
    .mockResolvedValueOnce(payout({ metadata: { bsPayoutClaim: "claim-1" } }))
    .mockResolvedValueOnce(payout({ metadata: { bsPayoutClaim: "other" } }));
  expect(
    await getRecipientPayoutReceipt(provider as unknown as Stripe, {
      ...scope,
      operationKey: "claim-1",
    }),
  ).toMatchObject({ status: "not_ready", reason: "provider_changed" });
});
it("does not suppress provider errors as proof of a missing receipt", async () => {
  const { provider, read } = setup();
  provider.balanceTransactions.retrieve.mockRejectedValue(
    new Error("provider unavailable"),
  );
  await expect(read()).rejects.toThrow("provider unavailable");
});
it("returns no totals when the original debit is not available", async () => {
  expect(await setup({ balance_transaction: null }).read()).toEqual({
    status: "not_ready",
    ...scope,
    reason: "debit_unavailable",
  });
});
it("rejects foreign payout identities and malformed scope", async () => {
  await expect(setup({ id: "po_other" }).read()).rejects.toThrow(/identity/);
  await expect(
    setup().read({ accountId: "acct_recipient\n", stripePayoutId: "po_one" }),
  ).rejects.toThrow(/identity/);
});
it("exposes the verifier through the public payout policy client", async () => {
  const { PayoutPolicyClient } = await import("../payoutPolicy.js");
  const { provider } = setup();
  const client = new PayoutPolicyClient(
    {} as never,
    () => provider as unknown as Stripe,
  );
  expect(
    client.payoutReceipt,
    "public payout receipt reader missing",
  ).toBeTypeOf("function");
  expect(await client.payoutReceipt(scope)).toMatchObject({
    status: "ready",
    stripePayoutId: "po_one",
  });
});
it.each([{ automatic: true }, { method: "instant" }, { type: "card" }])(
  "does not bind a non-standard payout to a durable bank claim (%j)",
  async (extra) => {
    const { provider } = setup({
      ...extra,
      metadata: { bsPayoutClaim: "claim-1" },
    });
    await expect(
      getRecipientPayoutReceipt(provider as unknown as Stripe, {
        ...scope,
        operationKey: "claim-1",
      }),
    ).rejects.toThrow(/claim/);
  },
);
it.each([{ status: "pending" }, { available_on: timestamp + 86400 }])(
  "does not book a payout debit before its fees and net are available (%j)",
  async (debit) => {
    const receipt = await setup({}, debit).read();
    expect(receipt).toEqual({
      status: "not_ready",
      ...scope,
      reason: "debit_pending",
    });
    expect(receipt).not.toHaveProperty("amount");
  },
);
