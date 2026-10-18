import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { setupAllowance } from "./allowance.fixtures.js";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const prepare = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:prepare",
);
const save = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:save",
);
afterEach(() => vi.useRealTimers());
it("keeps later subscription and allowance history pages inside the requested tenant when cursors are reused", async () => {
  const { t, meter, subscription, configure, bindingJson } =
    await setupAllowance();
  await configure();
  await configure(
    {
      reset: "billing_period",
      rollover: "none",
      entitled: true,
      overage: "allow",
      limit: { mode: "hard", quantity: "13" },
    },
    1,
  );
  const originalIntent = await t.mutation(prepare, {
    termsJson: JSON.stringify({ ...request, meters: [meter] }),
    method: "direct",
  });
  const renewed = nativeSubscription();
  renewed.cancel_at_period_end = true;
  await t.mutation(save, {
    key: originalIntent.key,
    nativeJson: JSON.stringify(renewed),
    startedAt: Date.now() + 1,
  });
  const foreign = {
    ...meter,
    scope: { ...meter.scope, customerAccount: "acct_other" },
    binding: { ...meter.binding, stripeCustomerId: "cus_other" },
  };
  const other = await t.mutation(prepare, {
    termsJson: JSON.stringify({ ...request, meters: [foreign] }),
    method: "direct",
  });
  const native = nativeSubscription();
  native.id = "sub_other";
  native.customer = "cus_other";
  native.customer_account = "acct_other";
  await t.mutation(save, {
    key: other.key,
    nativeJson: JSON.stringify(native),
    startedAt: Date.now(),
  });
  const otherBinding = JSON.stringify({
    ...foreign,
    subscription: { ...subscription, subscriptionId: "sub_other" },
  });
  await t.mutation(
    makeFunctionReference<"mutation">("usageAllowance/mutations:configure"),
    {
      bindingJson: otherBinding,
      policyJson: JSON.stringify({
        reset: "billing_period",
        rollover: "none",
        entitled: true,
        overage: "allow",
        limit: { mode: "none" },
      }),
      expectedRevision: 0,
    },
  );
  for (const kind of ["subscription", "allowance"]) {
    const query = makeFunctionReference<"query">(
      kind === "subscription"
        ? "usageSubscriptions/queries:history"
        : "usageAllowance/queries:readHistory",
    );
    const args =
      kind === "subscription"
        ? {
            scope: {
              stripeAccountId: meter.scope.stripeAccountId,
              customerAccount: meter.scope.customerAccount,
              livemode: false,
            },
            requestId: "signup1",
            kind: "subscription",
          }
        : { bindingJson };
    const otherArgs =
      kind === "subscription"
        ? {
            ...args,
            scope: {
              stripeAccountId: meter.scope.stripeAccountId,
              customerAccount: "acct_other",
              livemode: false,
            },
          }
        : { bindingJson: otherBinding };
    const first = await t.query(query, {
      ...args,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(first.isDone).toBe(false);
    const paginationOpts = { numItems: 1, cursor: first.continueCursor };
    const next = await t.query(query, { ...args, paginationOpts });
    expect(next).toEqual(await t.query(query, { ...args, paginationOpts }));
    expect(next.page).toHaveLength(1);
    try {
      const otherPage = await t.query(query, { ...otherArgs, paginationOpts });
      for (const row of otherPage.page) {
        if (kind === "subscription") expect(row.intentKey).toBe(other.key);
        else expect(row.key).not.toBe(first.page[0].key);
      }
    } catch (error) {
      expect(String(error)).toMatch(/cursor|range|index|position|pagination/i);
    }
  }
});
