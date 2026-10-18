import type { Component, RunCtx } from "../helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import { componentRef } from "../webhooks/helpers.js";
import {
  creditPurchaseTerms,
  type UsageCreditPurchaseOptions,
} from "./creditTerms.js";
import { creditRequire } from "./creditNative.js";
export async function findCreditPurchase(
  component: Component,
  ctx: RunCtx,
  input: UsageCreditPurchaseOptions,
) {
  const terms = creditPurchaseTerms(input);
  const row = (await ctx.runQuery(
    componentRef(component, "usageCredits/queries/getPurchase"),
    {
      bindingJson: JSON.stringify({
        scope: terms.scope,
        binding: terms.binding,
      }),
      purchaseId: terms.purchaseId,
    },
  )) as Doc<"usageCreditPurchases"> | null;
  creditRequire(row, "Credit purchase unavailable");
  const retained = creditPurchaseTerms(JSON.parse(row.termsJson));
  creditRequire(
    JSON.stringify(retained) === JSON.stringify(terms),
    "Original credit purchase terms conflict",
  );
  return { row, terms };
}
