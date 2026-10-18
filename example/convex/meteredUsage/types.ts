import type { UsagePriceBinding } from "@fantastic.dev/better-stripe";
import type { UsageSubscriptionView } from "@fantastic.dev/better-stripe/usage";
export type DemoProviderState = {
  clockId: string;
  productId: string;
  requestId: string;
  price: UsagePriceBinding;
  meter: UsageSubscriptionView["bindings"][number];
};
export type DemoSettlementPolicy = {
  creatorAccountId?: string;
  feeBasisPoints: number;
  commissionTerm: "one_time" | "forever";
  affiliate?: { destinationAccountId: string; basisPoints: number };
};
