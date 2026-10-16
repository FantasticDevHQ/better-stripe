// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { closeAccount } from "./accounts.js";
import { BetterStripe } from "../index.js";

const modules = import.meta.glob("../../component/**/*.ts");
function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const ctx = { runQuery: t.query, runMutation: t.mutation } as RunCtx;
  const close = vi.fn().mockResolvedValue({ closed: true });
  const retrieve = vi.fn().mockResolvedValue({ closed: true });
  const stripe = {
    v2: { core: { accounts: { close, retrieve } } },
  } as unknown as Stripe;
  const client = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_bts202_dummy",
  });
  return {
    client,
    t,
    ctx,
    stripe,
    close,
    retrieve,
    component: components.betterStripe,
  };
}

describe("account closure provenance", () => {
  it("does not resurrect a closed recipient on a late account upsert", async () => {
    const f = fixture();
    const account = {
      stripeAccountId: "acct_closed",
      userId: "original",
      appliedConfigurations: ["recipient" as const],
    };
    await f.t.mutation(f.component.core.mutations.upsertAccount, account);
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: account.stripeAccountId,
    });
    await f.t.mutation(f.component.core.mutations.upsertAccountInternal, {
      ...account,
      userId: "replacement",
      onboardingStatus: "complete",
    });
    await f.t.mutation(f.component.core.mutations.upsertAccount, account);
    expect(
      await f.t.query(f.component.core.queries.getAccountByUserId, {
        userId: "original",
      }),
    ).toBeNull();
    expect(
      await f.t.query(f.component.core.queries.getAccountByUserId, {
        userId: "replacement",
      }),
    ).toBeNull();
    expect(
      await f.t.query(f.component.core.queries.getAccountByStripeId, {
        stripeAccountId: account.stripeAccountId,
      }),
    ).toBeNull();
  });
  it("retains original owner history while active lookups move to another account", async () => {
    const f = fixture();
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_old",
      userId: "original",
      appliedConfigurations: ["recipient"],
    });
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_old",
    });
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_new",
      userId: "original",
    });
    const history = await f.client.listClosedAccountsByUserId(f.ctx, {
      userId: "original",
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(history.page.map((row) => row.stripeAccountId)).toEqual([
      "acct_old",
    ]);
    expect(history.page[0].userId).toBe("original");
    expect(history.page[0].closedAt).toBeTypeOf("number");
    expect(
      (
        await f.t.query(f.component.core.queries.getAccountByUserId, {
          userId: "original",
        })
      )?.stripeAccountId,
    ).toBe("acct_new");
    expect(
      (
        await f.t.query(
          f.component.accountClosure.queries.listClosedAccountsByUserId,
          {
            userId: "replacement",
            paginationOpts: { numItems: 1, cursor: null },
          },
        )
      ).page,
    ).toEqual([]);
  });

  it("keeps the live mapping after provider failure and pins its owner during retry", async () => {
    const f = fixture();
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_fail",
      userId: "original",
      appliedConfigurations: [],
    });
    f.close.mockRejectedValueOnce(new Error("provider refused"));
    await expect(
      closeAccount(f.stripe, f.component, f.ctx, {
        stripeAccountId: "acct_fail",
      }),
    ).rejects.toThrow("provider refused");
    expect(
      (
        await f.t.query(f.component.core.queries.getAccountByUserId, {
          userId: "original",
        })
      )?.stripeAccountId,
    ).toBe("acct_fail");
    expect(
      await f.t.query(
        f.component.accountClosure.queries.getClosedAccountByStripeId,
        { stripeAccountId: "acct_fail" },
      ),
    ).toBeNull();
    await expect(
      f.t.mutation(f.component.core.mutations.upsertAccount, {
        stripeAccountId: "acct_fail",
        userId: "replacement",
      }),
    ).rejects.toThrow("ownership is pinned");
    f.retrieve.mockResolvedValueOnce({
      closed: false,
      applied_configurations: [],
    });
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_fail",
    });
    expect(f.close).toHaveBeenCalledTimes(2);
    expect(f.close.mock.calls[0][2]).toEqual(f.close.mock.calls[1][2]);
    expect(
      (
        await f.t.query(
          f.component.accountClosure.queries.getClosedAccountByStripeId,
          { stripeAccountId: "acct_fail" },
        )
      )?.userId,
    ).toBe("original");
  });

  it("recovers provider success followed by local completion failure without another close", async () => {
    const f = fixture();
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_retry",
      userId: "original",
      appliedConfigurations: [],
    });
    const runMutation = vi
      .fn(f.t.mutation)
      .mockImplementationOnce(f.t.mutation)
      .mockRejectedValueOnce(new Error("local completion unavailable"));
    const ctx = { ...f.ctx, runMutation } as RunCtx;
    await expect(
      closeAccount(f.stripe, f.component, ctx, {
        stripeAccountId: "acct_retry",
      }),
    ).rejects.toThrow("local completion unavailable");
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_retry",
    });
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_retry",
    });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.close.mock.calls[0][2]).toEqual({
      idempotencyKey: "betterstripe-close:acct_retry",
    });
    expect(
      (
        await f.t.query(
          f.component.accountClosure.queries.getClosedAccountByStripeId,
          { stripeAccountId: "acct_retry" },
        )
      )?.userId,
    ).toBe("original");
  });

  it("does not disclose organization history through personal owner discovery", async () => {
    const f = fixture();
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: "acct_org",
      userId: "original",
      orgId: "org_private",
      appliedConfigurations: [],
    });
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_org",
    });
    expect(
      (
        await f.t.query(
          f.component.accountClosure.queries.listClosedAccountsByUserId,
          {
            userId: "original",
            paginationOpts: { numItems: 10, cursor: null },
          },
        )
      ).page,
    ).toEqual([]);
    expect(
      (
        await f.t.query(
          f.component.accountClosure.queries.getClosedAccountByStripeId,
          { stripeAccountId: "acct_org" },
        )
      )?.orgId,
    ).toBe("org_private");
  });
  it("preserves payout rows and original account references for historical reads", async () => {
    const f = fixture();
    const accountId = "acct_financial_history";
    await f.t.mutation(f.component.core.mutations.upsertAccount, {
      stripeAccountId: accountId,
      userId: "original",
      appliedConfigurations: [],
    });
    await f.t.mutation(f.component.connect.mutations.upsertPayout, {
      stripePayoutId: "po_retained",
      accountId,
      amount: 1200,
      currency: "usd",
      status: "paid",
    });
    const original = await f.t.query(
      f.component.connect.queries.getPayoutByStripeId,
      { stripePayoutId: "po_retained" },
    );
    await closeAccount(f.stripe, f.component, f.ctx, {
      stripeAccountId: accountId,
    });
    const owner = await f.client.getClosedAccountByStripeId(f.ctx, {
      stripeAccountId: accountId,
    });
    expect(owner?.userId).toBe("original");
    expect(owner?.orgId).toBeUndefined();
    expect(
      await f.t.query(f.component.connect.queries.listPayouts, {
        accountId: owner!.stripeAccountId,
      }),
    ).toEqual([original]);
    expect(
      await f.t.query(f.component.connect.queries.getPayoutByStripeId, {
        stripePayoutId: "po_retained",
      }),
    ).toEqual(original);
  });

  it("paginates personal closed history without unrelated users or organization rows", async () => {
    const f = fixture();
    for (const [stripeAccountId, userId, orgId] of [
      ["acct_p1", "original", undefined],
      ["acct_org_private", "original", "org_private"],
      ["acct_p2", "original", undefined],
      ["acct_other", "other", undefined],
    ]) {
      await f.t.mutation(f.component.core.mutations.upsertAccount, {
        stripeAccountId: stripeAccountId!,
        userId: userId!,
        orgId,
        appliedConfigurations: [],
      });
      await closeAccount(f.stripe, f.component, f.ctx, {
        stripeAccountId: stripeAccountId!,
      });
    }
    const first = await f.t.query(
      f.component.accountClosure.queries.listClosedAccountsByUserId,
      { userId: "original", paginationOpts: { numItems: 1, cursor: null } },
    );
    const second = await f.t.query(
      f.component.accountClosure.queries.listClosedAccountsByUserId,
      {
        userId: "original",
        paginationOpts: { numItems: 1, cursor: first.continueCursor },
      },
    );
    expect(
      [...first.page, ...second.page].map((row) => row.stripeAccountId).sort(),
    ).toEqual(["acct_p1", "acct_p2"]);
    expect(first.isDone).toBe(false);
    const end = await f.client.listClosedAccountsByUserId(f.ctx, {
      userId: "original",
      paginationOpts: { numItems: 1, cursor: second.continueCursor },
    });
    expect(end.page).toEqual([]);
    expect(end.isDone).toBe(true);
    for (const numItems of [0, 101, 1.5]) {
      await expect(
        f.client.listClosedAccountsByUserId(f.ctx, {
          userId: "original",
          paginationOpts: { numItems, cursor: null },
        }),
      ).rejects.toThrow("between 1 and 100");
    }
  });
});
