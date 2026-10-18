import { afterEach, expect, it, vi } from "vitest";
import { componentRef } from "../webhooks/helpers.js";
import type { RunCtx } from "../helpers.js";
import { fixture } from "./creditSettlement.fixtures.js";
afterEach(() => vi.useRealTimers());
it("preserves original prepaid affiliate recovery through partial consumption/refund, dispute, won reinstatement and a held correction", async () => {
  const f = await fixture({ fixedAmount: 7 });
  expect(await f.settle()).toMatchObject({
    status: "settled",
    platformNet: 12,
  });
  const event = {
      scope: f.purchase.scope,
      binding: f.purchase.binding,
      sourceEventId: "consume1",
      quantity: "6",
      occurredAt: 700,
    },
    subscription = f.view.bindings[0].subscription;
  const reservation = await f.t.action((ctx) =>
    f.client.usage.reserveCredits(ctx as RunCtx, { event, subscription }),
  );
  const receipt = await f.t.action((ctx) =>
    f.client.usage.record(ctx as RunCtx, {
      event,
      subscription,
      reservationId: reservation.reservationId,
    }),
  );
  const claim = (state: "refund" | "open" | "won") =>
    f.t.mutation(
      componentRef(f.component, "connect/mutations/claimReversalSlices"),
      {
        sourceChargeId: "ch_topup1",
        operationId: state === "refund" ? "re_partial" : "dp_credit",
        mode:
          state === "refund"
            ? { kind: "fraction", chargeAmount: 20, amountRefunded: 10 }
            : state === "won"
              ? { kind: "fraction", chargeAmount: 20, amountRefunded: 0 }
              : { kind: "amount", amount: 20 },
        commissionExposure:
          state === "refund"
            ? {
                kind: "refund",
                chargeAmount: 20,
                principal: 10,
                finalized: true,
                refundId: "re_partial",
              }
            : {
                kind: "dispute",
                chargeAmount: 20,
                principal: 20,
                finalized: false,
                disputeState: state,
                disputeId: "dp_credit",
                refundedPrincipal: 10,
              },
      },
    );
  const rows = async () =>
    (await f.t.query(
      componentRef(f.component, "settlement/queries/listAffiliateObligations"),
      {
        affiliateAccountId: "acct_affiliate",
        currency: "usd",
        paginationOpts: { numItems: 10, cursor: null },
      },
    )) as {
      page: Array<{
        _id: string;
        finalizedAmount: number;
        provisionalAmount: number;
        recoveredAmount: number;
        restoredAmount: number;
      }>;
    };
  f.state.refundedAmount = 10;
  await claim("refund");
  await f.t.mutation(
    componentRef(f.component, "connect/mutations/recordTransferReversal"),
    {
      stripeTransferId: "tr_0",
      reversedAmount: 4,
      receipt: {
        stripeReversalId: "trr_partial",
        operationId: "re_partial",
        amount: 4,
      },
    },
  );
  await claim("refund");
  expect((await rows()).page[0]).toMatchObject({
    finalizedAmount: 4,
    recoveredAmount: 4,
  });
  await claim("open");
  const obligationId = (await rows()).page[0]._id;
  const recover = (await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/reserveOperation"),
    { obligationId, kind: "recovery", now: 700000 },
  )) as { _id: string; amount: number };
  expect(recover.amount).toBe(3);
  await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/beginOperation"),
    { operationId: recover._id },
  );
  await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/completeOperation"),
    {
      operationId: recover._id,
      state: "succeeded",
      receiptId: "trr_dispute",
      confirmedTransferReversed: 7,
    },
  );
  await claim("won");
  const restore = (await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/reserveOperation"),
    { obligationId, kind: "restoration", now: 700000 },
  )) as { _id: string; amount: number };
  expect(restore.amount).toBe(3);
  await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/beginOperation"),
    { operationId: restore._id },
  );
  const confirmation = {
    operationId: restore._id,
    state: "succeeded",
    receiptId: "tr_restore",
  };
  await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/completeOperation"),
    confirmation,
  );
  await f.t.mutation(
    componentRef(f.component, "affiliateRecovery/mutations/completeOperation"),
    confirmation,
  );
  expect((await rows()).page[0]).toMatchObject({
    finalizedAmount: 4,
    provisionalAmount: 0,
    recoveredAmount: 7,
    restoredAmount: 3,
  });
  expect(await f.settle()).toMatchObject({
    status: "rejected",
    reason: "payment_not_payable",
  });
  expect(
    await f.t.action((ctx) =>
      f.client.usage.requestCorrection(
        ctx as RunCtx,
        {
          scope: event.scope,
          eventId: receipt.eventId,
          correctionId: "after_refund",
          actor: "operator1",
          reason: "duplicate activity",
          operation: "cancel",
        },
        f.options,
      ),
    ),
  ).toMatchObject({ state: "held", restoredQuantity: "0" });
  expect(
    await f.t.query((ctx) =>
      f.client.usage.getCreditBalance(ctx as RunCtx, f.purchase),
    ),
  ).toMatchObject({ consumedQuantity: "6" });
  expect(f.native).toHaveLength(1);
});
