// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { setup, scope, component } from "./payoutAdoptionTestHelpers.js";
import { collectLargePayoutInput } from "./payoutCollectedInput.js";
import { collectedSources } from "../../component/payoutSnapshots/financial.js";
import { financialRevision } from "../../component/payoutSnapshots/revisions.js";
import {
  checkSnapshot,
  transferFingerprint,
} from "../../component/payoutRelease/helpers.js";
async function fixture() {
  const s = await setup(Array.from({ length: 101 }, () => 10));
  const result = await collectLargePayoutInput(
    component,
    s.ctx,
    {
      accountId: scope.accountId,
      ownerKey: scope.ownerKey,
      operationKey: "cache-proof",
    },
    10,
  );
  if (result.status !== "ready") throw Error("Missing complete cache");
  const observations = result.transfers.map((row, i) => ({
    stripeTransferId: row.stripeTransferId,
    currency: "usd",
    matureNet: 10,
    pendingCredits: 0,
    ledgerFingerprint: transferFingerprint(row),
    observedAt: Date.now(),
    transactionIds: [`txn_${i}`],
  }));
  const snapshotId = result.collection.snapshotId;
  const verify = () =>
    s.t.run(async (ctx) => {
      const revision = await financialRevision(ctx, scope.accountId);
      const collected = await collectedSources(
        ctx,
        { ...scope, snapshotId, liabilityRevision: revision.riskRevision },
        observations,
      );
      const rows = await checkSnapshot(
        ctx,
        scope.accountId,
        observations,
        true,
        undefined,
        collected?.transfers,
      );
      return { sources: rows.size, allocations: collected?.allocations.size };
    });
  const rows = await s.t.run((ctx) =>
    ctx.db.query("payoutSnapshotSources").collect(),
  );
  return { s, rows, verify };
}
it("validates older caches without primary document IDs", async () => {
  const f = await fixture();
  await f.s.t.run(async (ctx) => {
    for (const row of f.rows)
      await ctx.db.patch("payoutSnapshotSources", row._id, {
        transferDocId: undefined,
        allocationDocId: undefined,
      });
  });
  expect(await f.verify()).toEqual({ sources: 101, allocations: 101 });
});
it("rejects a cached primary ID pointing to another funding source", async () => {
  const f = await fixture();
  await f.s.t.run((ctx) =>
    ctx.db.patch("payoutSnapshotSources", f.rows[0]._id, {
      transferDocId: f.rows[1].transferDocId,
    }),
  );
  await expect(f.verify()).rejects.toThrow("source changed");
});
it("rejects a cached primary allocation with foreign identity even when money matches", async () => {
  const f = await fixture();
  await f.s.t.run(async (ctx) => {
    const allocationDocId = await ctx.db.insert("payoutSourceAllocations", {
      accountId: "acct_foreign",
      ownerKey: "foreign",
      stripeTransferId: "tr_foreign",
      currency: "usd",
      paidAmount: 0,
      reservedAmount: 0,
    });
    await ctx.db.patch("payoutSnapshotSources", f.rows[0]._id, {
      allocationDocId,
    });
  });
  await expect(f.verify()).rejects.toThrow("allocation changed");
});
