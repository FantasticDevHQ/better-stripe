import { runAdoptionMutation } from "./payoutAdoptionCollection.js";
// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import type Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import { PayoutPolicyClient } from "../payoutPolicy.js";
import { setup, scope, component } from "./payoutAdoptionTestHelpers.js";
it.each(["proof read", "begin attempt"] as const)(
  "reconciles an identical activation completed while another caller was delayed at %s",
  async (boundary) => {
    const s = await setup(Array.from({ length: 101 }, () => 10));
    const now = Math.floor(Date.now() / 1000);
    s.setTransactions(
      s
        .transactions()
        .map((t) => ({ ...t, created: now - 100, available_on: now - 50 })),
    );
    s.provider.balanceTransactions.list.mockImplementation(async (params) => {
      const p = params as typeof params & {
        currency?: string;
        starting_after?: string;
      };
      const rows = s
        .transactions()
        .filter(
          (t) =>
            (!p.source || t.source === p.source) &&
            (!p.currency || t.currency === p.currency),
        );
      const start = p.starting_after
        ? rows.findIndex((t) => t.id === p.starting_after) + 1
        : 0;
      const data = rows.slice(start, start + (p.limit ?? 100));
      return { data, has_more: start + data.length < rows.length };
    });
    const client = clientFor(s);
    const operationKey = "concurrent-activate";
    expect(
      await client.prepare(s.ctx, {
        accountId: scope.accountId,
        ownerKey: scope.ownerKey,
        operationKey,
        expectedRevision: 0,
        mode: "custom",
        thresholds: [{ currency: "usd", amount: 1000 }],
        consent: true,
        adoptExistingBalance: true,
      }),
    ).toMatchObject({ status: "prepared" });
    let unblockFirst!: () => void, unblockSecond!: () => void;
    const secondIsReading = new Promise<void>((resolve) => {
      unblockFirst = resolve;
    });
    const firstCompleted = new Promise<void>((resolve) => {
      unblockSecond = resolve;
    });
    const query = s.ctx.runQuery,
      mutation = s.ctx.runMutation!;
    const path = (ref: unknown) =>
      (ref as Record<symbol, string>)[Symbol.for("toReferencePath")];
    const firstCtx: RunCtx = {
      ...s.ctx,
      runMutation: async (ref, ...args) => {
        if (path(ref).endsWith("payoutPolicy/mutations/beginAttempt"))
          await secondIsReading;
        return mutation(ref, ...args);
      },
    };
    let delayed = false;
    const secondCtx: RunCtx = {
      ...s.ctx,
      runQuery: async (ref, ...args) => {
        if (
          boundary === "proof read" &&
          !delayed &&
          path(ref).endsWith("payoutSnapshots/queries/sources")
        ) {
          delayed = true;
          unblockFirst();
          await firstCompleted;
        }
        return query(ref, ...args);
      },
      runMutation: async (ref, ...args) => {
        if (
          boundary === "begin attempt" &&
          path(ref).endsWith("payoutPolicy/mutations/beginAttempt")
        ) {
          delayed = true;
          unblockFirst();
          await firstCompleted;
        }
        return mutation(ref, ...args);
      },
    };
    const args = {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      operationKey,
    };
    const first = client.apply(firstCtx, args).finally(unblockSecond);
    const second = client.apply(secondCtx, args).finally(unblockFirst);
    const results = await Promise.allSettled([first, second]);
    expect(delayed).toBe(true);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    for (const result of results)
      if (result.status === "fulfilled")
        expect(result.value).toMatchObject({ status: "ready" });
    expect(await client.release(s.ctx, scope)).toMatchObject({
      status: "updated",
      claim: { status: "paid", amount: 1010 },
    });
    expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutSnapshots").collect()),
    ).toEqual([]);
  },
  15000,
);

it("preserves proof failures while the durable activation is still unattempted", async () => {
  const s = await setup([100]);
  const { collectResumableAdoptionProof } =
    await import("./payoutResumableProof.js");
  const failure = new Error("provider proof unavailable");
  s.provider.balance.retrieve.mockRejectedValueOnce(failure);
  const query = s.ctx.runQuery;
  const ctx: RunCtx = {
    ...s.ctx,
    runQuery: async (ref, ...args) => {
      const path = (ref as Record<symbol, string>)[
        Symbol.for("toReferencePath")
      ];
      if (path.endsWith("payoutPolicy/queries/operation"))
        return { status: "pending", attempted: false } as never;
      return query(ref, ...args);
    },
  };
  await expect(
    collectResumableAdoptionProof(
      s.provider as unknown as Stripe,
      component,
      ctx,
      { ...scope, operationKey: "still-unattempted" },
      0,
      ["usd"],
      "apply",
    ),
  ).rejects.toBe(failure);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

function clientFor(s: Awaited<ReturnType<typeof setup>>) {
  let schedule: Record<string, unknown> = {
    interval: "weekly",
    weekly_payout_days: ["monday"],
  };
  Object.assign(s.provider, {
    v2: {
      core: {
        accounts: {
          retrieve: async () => ({
            id: scope.accountId,
            dashboard: "none",
            identity: { country: "US" },
          }),
        },
      },
    },
    balanceSettings: {
      retrieve: async () => ({
        payments: { payouts: { status: "enabled", schedule } },
      }),
      update: async (args: {
        payments: { payouts: { schedule: Record<string, unknown> } };
      }) => {
        schedule = args.payments.payouts.schedule;
        return { payments: { payouts: { status: "enabled", schedule } } };
      },
    },
  });
  return new PayoutPolicyClient(
    component,
    () => s.provider as unknown as Stripe,
  );
}

it("reconciles a lost beginAttempt response without repeating an already-attempted boundary", async () => {
  const s = await setup([]),
    client = clientFor(s);
  const args = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    operationKey: "lost-begin-response",
  };
  expect(
    await client.prepare(s.ctx, {
      ...args,
      expectedRevision: 0,
      mode: "custom",
      thresholds: [{ currency: "usd", amount: 100 }],
      consent: true,
      adoptExistingBalance: true,
    }),
  ).toMatchObject({ status: "prepared" });
  const mutation = s.ctx.runMutation!;
  let begins = 0;
  const ctx: RunCtx = {
    ...s.ctx,
    runMutation: async (ref, ...params) => {
      const result = await mutation(ref, ...params);
      if (
        (ref as Record<symbol, string>)[Symbol.for("toReferencePath")].endsWith(
          "payoutPolicy/mutations/beginAttempt",
        ) &&
        ++begins === 1
      )
        throw Error(
          "Simulated lost response after the durable attempt committed",
        );
      return result;
    },
  };
  expect(await client.apply(ctx, args)).toMatchObject({
    status: "ready",
    operation: { attempted: true, status: "complete" },
  });
  expect(begins).toBe(1);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

it("preserves a genuine beginAttempt failure while the operation is unattempted", async () => {
  const s = await setup([]),
    client = clientFor(s);
  const args = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    operationKey: "unattempted-boundary-failure",
  };
  expect(
    await client.prepare(s.ctx, {
      ...args,
      expectedRevision: 0,
      mode: "custom",
      thresholds: [{ currency: "usd", amount: 100 }],
      consent: true,
      adoptExistingBalance: true,
    }),
  ).toMatchObject({ status: "prepared" });
  const failure = Error(
    "Simulated unavailable mutation before any attempt committed",
  );
  const ctx: RunCtx = {
    ...s.ctx,
    runMutation: async () => {
      throw failure;
    },
  };
  await expect(
    runAdoptionMutation(component, ctx, "beginAttempt", args),
  ).rejects.toBe(failure);
  const operation = await client.operation(s.ctx, args);
  expect(operation).toMatchObject({ status: "pending" });
  expect(operation?.attempted).not.toBe(true);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
