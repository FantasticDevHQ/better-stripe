// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.*s");
const m = (name: string) =>
  makeFunctionReference<"mutation">(`connect/mutations:${name}`);
const transfer = (id = "tr_one", extra = {}) => ({
  stripeTransferId: id,
  destinationAccountId: "acct_one",
  amount: 1000,
  currency: "usd",
  role: "affiliate",
  status: "paid",
  sourceChargeId: "ch_one",
  ...extra,
});
const test = () => convexTest(schema, modules);
const revision = (t: ReturnType<typeof test>, accountId = "acct_one") =>
  t.run((ctx) =>
    ctx.db
      .query("payoutFinancialRevisions")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .unique(),
  );
it("records new positive funding without invalidating older risk-fenced snapshots", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  expect(await revision(t)).toMatchObject({ revision: 1, riskRevision: 0 });
  await t.mutation(m("upsertTransfer"), transfer("tr_two"));
  expect(await revision(t)).toMatchObject({ revision: 2, riskRevision: 0 });
});
it("does not invalidate snapshots for replay or metadata-only changes", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  await t.mutation(
    m("upsertTransfer"),
    transfer("tr_one", { metadata: { note: "cosmetic" } }),
  );
  expect(await revision(t)).toMatchObject({ revision: 1, riskRevision: 0 });
});
it("invalidates risk when a refund/reversal reduces source funding", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  await t.mutation(m("recordTransferReversal"), {
    stripeTransferId: "tr_one",
    reversedAmount: 100,
  });
  expect(await revision(t)).toMatchObject({ revision: 2, riskRevision: 1 });
  await t.mutation(m("recordTransferReversal"), {
    stripeTransferId: "tr_one",
    reversedAmount: 100,
  });
  expect(await revision(t)).toMatchObject({ revision: 2, riskRevision: 1 });
});
it("reserved reversals invalidate risk before Stripe I/O", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  await t.mutation(m("claimReversalSlices"), {
    operationId: "refund-one",
    sourceChargeId: "ch_one",
    mode: { kind: "fraction", chargeAmount: 1000, amountRefunded: 500 },
  });
  expect(await revision(t)).toMatchObject({ revision: 2, riskRevision: 1 });
});
it("a moved source invalidates both account scopes", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  await t.mutation(
    m("upsertTransfer"),
    transfer("tr_one", { destinationAccountId: "acct_other" }),
  );
  expect(await revision(t)).toMatchObject({ revision: 2, riskRevision: 1 });
  expect(await revision(t, "acct_other")).toMatchObject({
    revision: 1,
    riskRevision: 1,
  });
});
it("concurrent independent source inserts cannot lose revision updates", async () => {
  const t = test();
  await Promise.all([
    t.mutation(m("upsertTransfer"), transfer("tr_one")),
    t.mutation(m("upsertTransfer"), transfer("tr_two")),
  ]);
  expect(await revision(t)).toMatchObject({ revision: 2, riskRevision: 0 });
});
it("provider payout outcomes invalidate account cash risk", async () => {
  const t = test();
  await t.mutation(m("upsertPayout"), {
    stripePayoutId: "po_one",
    accountId: "acct_one",
    amount: 1000,
    currency: "usd",
    status: "pending",
    arrivalDate: new Date().toISOString(),
  });
  expect(await revision(t)).toMatchObject({ revision: 1, riskRevision: 1 });
});
it("records an ordered account risk journal for incremental repair", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  await t.mutation(m("recordTransferReversal"), {
    stripeTransferId: "tr_one",
    reversedAmount: 100,
  });
  const events = await t.run((ctx) =>
    ctx.db.query("payoutRiskEvents").collect(),
  );
  expect(events).toMatchObject([
    { accountId: "acct_one", riskRevision: 1, kind: "transfer", key: "tr_one" },
  ]);
});
it("positive writes leave the isolated risk fence unchanged", async () => {
  const t = test();
  await t.mutation(m("upsertTransfer"), transfer());
  const first = await t.run((ctx) =>
    ctx.db.query("payoutRiskRevisions").collect(),
  );
  expect(first).toMatchObject([{ accountId: "acct_one", riskRevision: 0 }]);
  await t.mutation(m("upsertTransfer"), transfer("tr_two"));
  expect(
    await t.run((ctx) => ctx.db.query("payoutRiskRevisions").collect()),
  ).toEqual(first);
});
