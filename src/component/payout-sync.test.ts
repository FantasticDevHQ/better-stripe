// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
const scope = { stripePayoutId: "po_one", accountId: "acct_owner" };
const payout = {
  ...scope,
  amount: 500,
  currency: "jpy",
  status: "paid" as const,
  arrivalDate: "1970-01-01T00:03:20.000Z",
  method: "standard",
  metadata: {},
};
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`payoutSync/mutations:${name}`);
async function setup() {
  const t = convexTest(schema, modules);
  const generation = await t.mutation(mutation("begin"), scope);
  return { t, args: { ...scope, generation, payout } };
}
it("replays a committed generation without changing its acceptance time or financial row", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(1000);
    const { t, args } = await setup();
    const first = await t.mutation(mutation("finish"), args);
    const oldRow = await t.run((ctx) => ctx.db.query("payouts").unique());
    vi.setSystemTime(2000);
    expect(await t.mutation(mutation("finish"), args)).toMatchObject({
      ...first,
      changed: false,
    });
    expect(
      await t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
    ).toMatchObject({ acceptedAt: 1000 });
    expect(await t.run((ctx) => ctx.db.query("payouts").unique())).toEqual(
      oldRow,
    );
  } finally {
    vi.useRealTimers();
  }
});
it("rejects replacing the accepted snapshot under the same generation", async () => {
  const { t, args } = await setup();
  await t.mutation(mutation("finish"), args);
  await expect(
    t.mutation(mutation("finish"), {
      ...args,
      payout: { ...payout, status: "pending" },
    }),
  ).rejects.toThrow("An accepted payout observation cannot be replaced.");
  expect(await t.run((ctx) => ctx.db.query("payouts").unique())).toMatchObject({
    status: "paid",
  });
});
it("ignores stale completion and stale unknown markers before any financial write", async () => {
  const { t, args } = await setup();
  const generation = await t.mutation(mutation("begin"), scope);
  expect(await t.mutation(mutation("finish"), args)).toMatchObject({
    status: "superseded",
  });
  await t.mutation(mutation("markUnknown"), {
    ...scope,
    generation: args.generation,
  });
  expect(
    await t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
  ).toMatchObject({ status: "pending", generation });
  expect(await t.run((ctx) => ctx.db.query("payouts").collect())).toEqual([]);
  await t.mutation(mutation("finish"), { ...args, generation });
  await t.mutation(mutation("markUnknown"), { ...scope, generation });
  expect(
    await t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
  ).toMatchObject({ status: "accepted" });
});
it.each([{ stripePayoutId: "po_foreign" }, { accountId: "acct_foreign" }])(
  "rejects snapshot identity mismatch %j atomically",
  async (patch) => {
    const { t, args } = await setup();
    await expect(
      t.mutation(mutation("finish"), {
        ...args,
        payout: { ...payout, ...patch },
      }),
    ).rejects.toThrow(
      "Payout synchronization snapshot identity does not match.",
    );
    expect(await t.run((ctx) => ctx.db.query("payouts").collect())).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("currencyTotals").collect()),
    ).toEqual([]);
  },
);
it("rejects a foreign claim lookup and generation overflow without changing the claim", async () => {
  const { t } = await setup();
  await expect(
    t.query(makeFunctionReference<"query">("payoutSync/queries:get"), {
      ...scope,
      accountId: "acct_foreign",
    }),
  ).rejects.toThrow("Payout synchronization account does not match.");
  await t.run(async (ctx) => {
    const row = await ctx.db.query("payoutSyncClaims").unique();
    await ctx.db.patch("payoutSyncClaims", row!._id, {
      generation: Number.MAX_SAFE_INTEGER,
    });
  });
  await expect(t.mutation(mutation("begin"), scope)).rejects.toThrow(
    "Payout synchronization generation exhausted.",
  );
  expect(
    await t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
  ).toMatchObject({ generation: Number.MAX_SAFE_INTEGER });
});
