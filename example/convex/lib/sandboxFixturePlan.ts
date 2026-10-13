export const FIXTURE_VERSION = "betterstripe_sandbox_v1";
export const FIXTURE_SELLERS = [
  "jordan@example.com",
  "maya@example.com",
  "sasha@example.com",
] as const;
export const SANDBOX_SALES = Array.from({ length: 36 }, (_, index) => ({
  key: `sale:${index}`,
  sellerEmail: (["maya@example.com", "sasha@example.com"] as const)[
    Math.floor(index / 18)
  ],
  amount: [10000, 12900][Math.floor(index / 18)] * (index % 4 === 0 ? 2 : 1),
  referred: index % 2 === 0,
  paymentMethod:
    index === 4 ? "pm_card_pendingRefund" : "pm_card_bypassPending",
}));
export const SANDBOX_REFUNDS = [
  { saleIndex: 0, amount: undefined },
  { saleIndex: 1, amount: 1000 },
  { saleIndex: 12, amount: 2500 },
  { saleIndex: 24, amount: undefined },
  { saleIndex: 4, amount: 1000 },
  { saleIndex: 5, amount: 1000 },
] as const;
export const SANDBOX_DISPUTES = [
  {
    key: "fraud-open",
    sellerEmail: "maya@example.com",
    paymentMethod: "pm_card_createDispute",
    outcome: "open",
  },
  {
    key: "not-received-open",
    sellerEmail: "sasha@example.com",
    paymentMethod: "pm_card_createDisputeProductNotReceived",
    outcome: "open",
  },
  {
    key: "not-received-won",
    sellerEmail: "maya@example.com",
    paymentMethod: "pm_card_createDisputeProductNotReceived",
    outcome: "won",
  },
  {
    key: "not-received-lost",
    sellerEmail: "sasha@example.com",
    paymentMethod: "pm_card_createDisputeProductNotReceived",
    outcome: "lost",
  },
] as const;
export function fixtureKey(accountId: string, scenario: string) {
  return `${FIXTURE_VERSION}:${accountId}:${scenario}`;
}
