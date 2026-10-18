import type Stripe from "stripe";
import { creditRequire, nativeCustomerId } from "./creditNative.js";
import type { UsageCreditPurchaseTerms } from "./creditTerms.js";
/** Read-only, bounded prepayment guard. Pending component intents reserve slots separately. */
export async function verifyNativeCreditCapacity(
  stripe: Stripe,
  terms: UsageCreditPurchaseTerms,
  pending: number,
) {
  let cursor: string | undefined,
    complete = false;
  const candidates: Stripe.Billing.CreditGrant[] = [];
  for (let page = 0; page < 10; page++) {
    const result = await stripe.billing.creditGrants.list({
      customer_account: terms.scope.customerAccount,
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    creditRequire(
      Array.isArray(result.data) &&
        result.data.length <= 100 &&
        typeof result.has_more === "boolean",
      "Native credit inventory page exceeds proof budget",
    );
    for (const grant of result.data) {
      creditRequire(
        grant.customer_account === terms.scope.customerAccount &&
          nativeCustomerId(grant.customer) === terms.binding.stripeCustomerId &&
          grant.livemode === terms.scope.livemode,
        "Native credit inventory scope mismatch",
      );
      if (
        !grant.voided_at &&
        (grant.expires_at === null || grant.expires_at > Date.now() / 1000)
      )
        candidates.push(grant);
    }
    creditRequire(
      candidates.length <= 100,
      "Native credit capacity proof budget exceeded",
    );
    if (!result.has_more) {
      complete = true;
      break;
    }
    const next = result.data[result.data.length - 1]?.id;
    creditRequire(
      next && next !== cursor,
      "Native credit capacity inventory incomplete",
    );
    cursor = next;
  }
  creditRequire(complete, "Native credit capacity inventory incomplete");
  let unused = 0;
  for (let start = 0; start < candidates.length; start += 5) {
    const balances = await Promise.all(
      candidates.slice(start, start + 5).map((grant) =>
        stripe.billing.creditBalanceSummaries.retrieve({
          customer_account: terms.scope.customerAccount,
          filter: { type: "credit_grant", credit_grant: grant.id },
        }),
      ),
    );
    for (const balance of balances) {
      creditRequire(
        balance.livemode === terms.scope.livemode &&
          balance.customer_account === terms.scope.customerAccount &&
          nativeCustomerId(balance.customer) ===
            terms.binding.stripeCustomerId &&
          balance.balances.length === 1,
        "Native credit capacity balance unavailable",
      );
      const value = balance.balances[0].ledger_balance.monetary?.value;
      creditRequire(
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
        "Native credit capacity amount unavailable",
      );
      if (value > 0) unused++;
    }
  }
  creditRequire(
    Number.isInteger(pending) && pending >= 1 && unused + pending <= 100,
    "Native unused credit grant capacity exhausted",
  );
}
