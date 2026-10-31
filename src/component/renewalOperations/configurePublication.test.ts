import { afterEach, expect, it, vi } from "vitest";
import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
import {
  canonicalConfigure,
  configureAcknowledgementFixture,
} from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
it("publishes only matching C9 event3 and preserves identical retention/readback", async () => {
  const h = await configureAcknowledgementFixture("object");
  const retained = await h.t.mutation(h.retain, h.retainArgs);
  const data = {
    event: "receipt",
    stage: "configure",
    request: h.request,
    receipt: h.receipt,
  };
  const event = await canonicalJournalEvent(3, canonicalConfigure(data));
  const args = {
    reservation: h.acquired.reservation,
    expectedSequence: 2,
    event: { sequence: 3, binding: event.binding, dataJSON: event.json },
  };
  const appended = await h.t.mutation(h.append, args);
  expect(appended.stage).toBe("configure");
  expect(await h.t.mutation(h.append, args)).toEqual(appended);
  expect(await h.t.mutation(h.retain, h.retainArgs)).toEqual(retained);
  const read = await h.t.query(h.readAcknowledgement, {
    operationId: h.created.operationId,
  });
  expect(read).toEqual({
    retention: retained,
    receiptJSON: h.retainArgs.receiptJSON,
  });
  expect(
    (
      await h.t.query(h.readAttempt, {
        operationId: h.created.operationId,
        attemptId: h.acquired.reservation.attemptId,
      })
    ).events,
  ).toHaveLength(3);
  expect(h.fetches()).toBe(0);
});
it.each(["body", "request", "stage", "extra-field"])(
  "rejects contradictory %s event3 without altering known C9 DATA",
  async (change) => {
    const h = await configureAcknowledgementFixture();
    const retained = await h.t.mutation(h.retain, h.retainArgs);
    const data = JSON.parse(
      canonicalConfigure({
        event: "receipt",
        stage: "configure",
        request: h.request,
        receipt: h.receipt,
      }),
    );
    if (change === "body")
      data.receipt.providerSnapshot.futureResponse = { changed: true };
    if (change === "request") data.request.key += ":foreign";
    if (change === "stage") data.stage = "attach";
    if (change === "extra-field") data.receipt.future = "unowned";
    const event = await canonicalJournalEvent(3, canonicalConfigure(data));
    await expect(
      h.t.mutation(h.append, {
        reservation: h.acquired.reservation,
        expectedSequence: 2,
        event: { sequence: 3, binding: event.binding, dataJSON: event.json },
      }),
    ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
    expect(
      await h.t.query(h.readAcknowledgement, {
        operationId: h.created.operationId,
      }),
    ).toEqual({ retention: retained, receiptJSON: h.retainArgs.receiptJSON });
    expect(
      (
        await h.t.query(h.readAttempt, {
          operationId: h.created.operationId,
          attemptId: h.acquired.reservation.attemptId,
        })
      ).events,
    ).toHaveLength(2);
  },
);
