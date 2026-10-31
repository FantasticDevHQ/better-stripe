import { afterEach, expect, it, vi } from "vitest";
import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
import { configureAcknowledgementFixture } from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
it("retains a large complete C9 at head2 and validates its actual receipt event independently", async () => {
  const h = await configureAcknowledgementFixture("absent", {
    padding: "x".repeat(450000),
  });
  expect(h.retainArgs.receiptJSON.length).toBeGreaterThan(450000);
  const prospective = JSON.stringify({
    event: "receipt",
    stage: "configure",
    request: h.request,
    receipt: h.receipt,
  });
  expect(prospective.length).toBeLessThan(500000);
  const retained = await h.t.mutation(h.retain, h.retainArgs);
  expect(retained.stage).toBe("configure");
  const event = await canonicalJournalEvent(3, prospective);
  await h.t.mutation(h.append, {
    reservation: h.acquired.reservation,
    expectedSequence: 2,
    event: { sequence: 3, binding: event.binding, dataJSON: event.json },
  });
  const read = await h.t.query(h.readAcknowledgement, {
    operationId: h.created.operationId,
  });
  expect(read.receiptJSON).toBe(h.retainArgs.receiptJSON);
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
