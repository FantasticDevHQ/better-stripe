// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import type {
  DefaultFunctionArgs,
  RegisteredQuery,
  RegisteredMutation,
} from "convex/server";
import type { MutationCtx } from "../_generated/server.js";
import { componentDb } from "../../testing/component-db.js";
import { schema, modules } from "../../test.js";
import { policies, changing, recovering } from "./queries.js";
import { due } from "../payoutPolicy/queries.js";
import { pendingPayouts } from "../affiliatePayouts/queries.js";
import { listClaims } from "../costRecovery/queries.js";
import { begin, advance } from "../payoutSnapshots/mutations.js";
function handler<Args extends DefaultFunctionArgs, Result>(
  fn:
    | RegisteredQuery<"public", Args, Result>
    | RegisteredMutation<"public", Args, Result>,
) {
  const run = (
    fn as unknown as { _handler: (ctx: MutationCtx, args: Args) => Result }
  )._handler;
  return (ctx: MutationCtx, args: Args) =>
    run({ ...ctx, db: componentDb(ctx.db) }, args);
}
const options = { numItems: 1, cursor: null };
const policy = {
  ownerKey: "owner",
  mode: "custom" as const,
  status: "ready" as const,
  revision: 0,
  operationKey: "enable",
  country: "US",
  thresholds: [{ currency: "usd", amount: 1000 }],
  holdDeadline: Date.now() - 1,
};
it("pages ready, changing and expired policies across the deployed component boundary", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++)
      await ctx.db.insert("payoutPolicies", {
        ...policy,
        accountId: `acct_${i}`,
      });
    await ctx.db.insert("payoutPolicies", {
      ...policy,
      accountId: "acct_changing",
      status: "changing",
    });
    await ctx.db.insert("payoutPolicies", {
      ...policy,
      accountId: "acct_default",
      mode: "stripe_managed",
      holdDeadline: undefined,
    });
    const accounts: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const p = await handler(policies)(ctx, {
        paginationOpts: { ...options, cursor },
      });
      accounts.push(...p.page.map((row) => row.accountId));
      cursor = p.continueCursor;
      if (p.isDone) break;
    }
    expect(accounts).toEqual(["acct_0", "acct_1", "acct_2"]);
    const changePage = await handler(changing)(ctx, {
      paginationOpts: options,
    });
    expect(changePage.page).toMatchObject([{ accountId: "acct_changing" }]);
    expect(
      await handler(changing)(ctx, {
        paginationOpts: { ...options, cursor: changePage.continueCursor },
      }),
    ).toMatchObject({ page: [], isDone: true });
    const expired: string[] = [];
    cursor = null;
    for (let i = 0; i < 6; i++) {
      const p = await handler(due)(ctx, {
        now: Date.now(),
        paginationOpts: { ...options, cursor },
      });
      expired.push(...p.page.map((row) => row.accountId));
      cursor = p.continueCursor;
      if (p.isDone) break;
    }
    expect(expired).toEqual(["acct_0", "acct_1", "acct_2", "acct_changing"]);
  });
});
it("pages only due unresolved worker operations", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const base = {
      accountId: "acct_one",
      ownerKey: "owner",
      currency: "usd",
      generation: 1,
      sequence: 1,
      cadenceMs: 60000,
      nextAttemptAt: Date.now() - 1,
      hasOperation: true,
    };
    for (let i = 0; i < 3; i++)
      await ctx.db.insert("payoutWorkerJobs", {
        ...base,
        accountId: `acct_${i}`,
      });
    await ctx.db.insert("payoutWorkerJobs", {
      ...base,
      accountId: "acct_future",
      nextAttemptAt: Date.now() + 86400000,
    });
    await ctx.db.insert("payoutWorkerJobs", {
      ...base,
      accountId: "acct_idle",
      hasOperation: false,
    });
    const accounts: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const p = await handler(recovering)(ctx, {
        paginationOpts: { ...options, cursor },
      });
      accounts.push(...p.page.map((row) => row.accountId));
      cursor = p.continueCursor;
      if (p.isDone) break;
    }
    expect(accounts).toEqual(["acct_0", "acct_1", "acct_2"]);
  });
});
it("reads affiliate reconciliation and seller cost history without native pagination", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    expect(
      await handler(pendingPayouts)(ctx, {
        state: "unknown",
        paginationOpts: options,
      }),
    ).toMatchObject({ page: [], isDone: true });
    expect(
      await handler(listClaims)(ctx, {
        accountId: "acct_one",
        scopeKey: "store_one",
        currency: "usd",
        paginationOpts: options,
      }),
    ).toMatchObject({ page: [], isDone: true });
  });
});
it("continues every local collection phase across bounded component-compatible pages", async () => {
  const t = convexTest(schema, modules);
  const scope = {
    accountId: "acct_one",
    ownerKey: "owner",
    operationKey: "collect",
  };
  await t.run(async (ctx) => {
    for (let i = 0; i < 31; i++)
      await ctx.db.insert("transfers", {
        stripeTransferId: `tr_${i}`,
        destinationAccountId: scope.accountId,
        amount: 1000,
        currency: "usd",
        role: "store",
        status: "paid",
      });
    await ctx.db.insert("payoutSourceAllocations", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      stripeTransferId: "tr_0",
      currency: "usd",
      paidAmount: 10,
      reservedAmount: 0,
    });
    await ctx.db.insert("payoutFeeBalances", {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      currency: "usd",
      amount: 2,
      revision: 0,
    });
    await ctx.db.insert("payoutReleaseClaims", {
      ...scope,
      operationKey: "previous",
      expectedRevision: 0,
      currency: "usd",
      amount: 10,
      status: "paid",
      stripePayoutId: "po_previous",
      allocations: [{ stripeTransferId: "tr_0", amount: 10, role: "store" }],
      observations: [],
    });
    let state = await handler(begin)(ctx, { ...scope, expectedRevision: -1 });
    for (let i = 0; i < 30 && state.phase !== "local_ready"; i++)
      state = await handler(advance)(ctx, {
        ...scope,
        expectedStep: state.step,
        batchSize: 5,
      });
    expect(state).toMatchObject({
      phase: "local_ready",
      sourceCount: 31,
      allocationCount: 1,
      claimCount: 1,
      feeCount: 1,
      readOnly: true,
    });
  });
});
