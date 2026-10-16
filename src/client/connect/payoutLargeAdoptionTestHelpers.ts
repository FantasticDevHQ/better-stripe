import type Stripe from "stripe";
import { adoptRecipientPayouts } from "./payoutAdoption.js";
import { setup, scope, component } from "./payoutAdoptionTestHelpers.js";
export async function large(count = 205, amount = 10) {
  const s = await setup(Array.from({ length: count }, () => amount));
  s.provider.balanceTransactions.list.mockImplementation(async (params) => {
    const p = params as typeof params & {
      currency?: string;
      starting_after?: string;
    };
    const all = s
      .transactions()
      .filter(
        (t) =>
          (!p.source || t.source === p.source) &&
          (!p.currency || t.currency === p.currency),
      );
    const start = p.starting_after
      ? all.findIndex((t) => t.id === p.starting_after) + 1
      : 0;
    const data = all.slice(start, start + (p.limit ?? 100));
    return { data, has_more: start + data.length < all.length };
  });
  return s;
}

export async function withHistory(count = 205, amount = 10) {
  const s = await large(count, amount);
  const payouts: {
    stripePayoutId: string;
    allocations: { stripeTransferId: string; amount: number }[];
  }[] = [];
  const history: Record<string, unknown>[] = [];
  for (let i = 0; i < 101; i++) {
    const p = await s.provider.payouts.create({
      amount: 10,
      currency: "usd",
      metadata: {},
    });
    history.push(p);
    payouts.push({
      stripePayoutId: String(p.id),
      allocations: [{ stripeTransferId: `tr_${i % count}`, amount: 10 }],
    });
  }
  s.provider.payouts.create.mockClear();
  s.provider.payouts.list.mockImplementation(async (...args: unknown[]) => {
    const params = (args[0] ?? {}) as {
      limit?: number;
      starting_after?: string;
    };
    const all = [...history].reverse();
    const start = params.starting_after
      ? all.findIndex((p) => p.id === params.starting_after) + 1
      : 0;
    const data = all.slice(start, start + (params.limit ?? 100));
    return { data, has_more: start + data.length < all.length };
  });
  const opts = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    currency: "usd",
    expectedRevision: 0,
    payouts,
  };
  const adopt = () =>
    adoptRecipientPayouts(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      opts,
    );
  return { s, adopt, opts };
}
