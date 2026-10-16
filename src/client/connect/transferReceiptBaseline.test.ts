// @vitest-environment edge-runtime
import type Stripe from "stripe";
import { expect, it } from "vitest";
import { setup, component, scope } from "./payoutAdoptionTestHelpers.js";
import { getTransferFundingReceipt } from "./transferReceipt.js";
it("reuses an already read baseline while still rereading the current ledger", async () => {
  const s = await setup([100]);
  const row = await s.t.run((ctx) => ctx.db.query("transfers").first());
  if (!row) throw Error("Missing source");
  let reads = 0;
  const runQuery = s.ctx.runQuery;
  const ctx = {
    ...s.ctx,
    runQuery: ((ref, ...args) => {
      if (
        (ref as Record<symbol, string>)[Symbol.for("toReferencePath")].endsWith(
          "getTransferByStripeId",
        )
      )
        reads++;
      return runQuery(ref, ...args);
    }) as typeof runQuery,
  };
  expect(
    await getTransferFundingReceipt(
      s.provider as unknown as Stripe,
      component,
      ctx,
      { accountId: scope.accountId, stripeTransferId: row.stripeTransferId },
      row,
    ),
  ).toMatchObject({ status: "ready" });
  expect(reads).toBe(1);
});
it("rejects a ledger change after an already read baseline", async () => {
  const s = await setup([100]);
  const row = await s.t.run((ctx) => ctx.db.query("transfers").first());
  if (!row) throw Error("Missing source");
  const retrieve = s.provider.transfers.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => {
    await s.t.run((ctx) =>
      ctx.db.patch("transfers", row._id, { role: "other" }),
    );
    return retrieve(id);
  });
  expect(
    await getTransferFundingReceipt(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      { accountId: scope.accountId, stripeTransferId: row.stripeTransferId },
      row,
    ),
  ).toMatchObject({ status: "not_ready", reason: "ledger_changed" });
});
