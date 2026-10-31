import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalConfigure,
  configureAcknowledgementFixture,
} from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
it.each([
  "body",
  "binding",
  "transport",
  "request",
  "foreign-C3",
  "extra-field",
])("refuses changed %s receipt DATA before first retention", async (change) => {
  const h = await configureAcknowledgementFixture();
  const receipt = JSON.parse(h.retainArgs.receiptJSON);
  if (change === "body")
    receipt.providerSnapshot.futureResponse = { changed: true };
  if (change === "binding")
    receipt.binding = "renewal-configure-receipt:v2:sha256:" + "0".repeat(64);
  if (change === "transport") receipt.transport.requestId = "req_foreign";
  if (change === "request") receipt.request.key += ":foreign";
  if (change === "extra-field") receipt.future = "unowned";
  const receiptJSON =
    change === "foreign-C3"
      ? canonicalConfigure(h.record.configureRecord.attachReceipt)
      : canonicalConfigure(receipt);
  await expect(
    h.t.mutation(h.retain, { ...h.retainArgs, receiptJSON }),
  ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
  expect(
    await h.t.query(h.readAcknowledgement, {
      operationId: h.created.operationId,
    }),
  ).toBeNull();
  expect(
    (
      await h.t.query(h.readAttempt, {
        operationId: h.created.operationId,
        attemptId: h.acquired.reservation.attemptId,
      })
    ).events,
  ).toHaveLength(2);
  expect(h.fetches()).toBe(0);
});
it.each(["receipt-payload", "basis-origin", "parent-reference"])(
  "corrupt %s makes bounded configure reads refuse without repair",
  async (change) => {
    const h = await configureAcknowledgementFixture();
    const retained = await h.t.mutation(h.retain, h.retainArgs);
    await h.t.run(async (ctx) => {
      if (change === "receipt-payload")
        await ctx.db.patch(
          "renewalOperationPayloads",
          retained.receiptPayloadId,
          { json: "{}" },
        );
      if (change === "basis-origin") {
        const row = await ctx.db.get(
          "renewalOperations",
          h.created.operationId,
        );
        if (!row?.initialBasis) throw Error("MISSING_FIXTURE_BASIS");
        const basis = JSON.parse(row.initialBasis.basisJSON);
        basis.startWallMs++;
        basis.startNsDecimal = String(BigInt(basis.startNsDecimal) + 1000000n);
        await ctx.db.patch("renewalOperations", row._id, {
          initialBasis: {
            ...row.initialBasis,
            basisJSON: canonicalConfigure(basis),
          },
        });
      }
      if (change === "parent-reference")
        await ctx.db.patch("renewalOperations", h.parentCreated.operationId, {
          activeAttemptId: h.acquired.reservation.attemptId,
        });
    });
    const before = await h.t.run((ctx) =>
      ctx.db.query("renewalOperations").take(3),
    );
    await expect(
      h.t.query(h.load, { operationId: h.created.operationId }),
    ).rejects.toThrow();
    await expect(
      h.t.query(h.readAcknowledgement, { operationId: h.created.operationId }),
    ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
    await expect(h.t.mutation(h.retain, h.retainArgs)).rejects.toThrow(
      "RENEWAL_JOURNAL_CONFLICT",
    );
    expect(
      await h.t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
    ).toEqual(before);
  },
);
