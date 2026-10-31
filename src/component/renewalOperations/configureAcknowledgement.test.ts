import { afterEach, expect, it, vi } from "vitest";
import { configureAcknowledgementFixture } from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
it.each(["absent", "null", "object"] as const)(
  "retains complete C9 DATA at head2 with %s defaults without claiming receipt3",
  async (defaults) => {
    const h = await configureAcknowledgementFixture(defaults);
    const retained = await h.t.mutation(h.retain, h.retainArgs);
    expect(retained.status).toBe("retained");
    expect(retained.stage).toBe("configure");
    expect(retained.receiptBinding).toBe(h.receipt.binding);
    const read = await h.t.query(h.readAcknowledgement, {
      operationId: h.created.operationId,
    });
    expect(read.retention).toEqual(retained);
    expect(read.receiptJSON).toBe(h.retainArgs.receiptJSON);
    expect(JSON.parse(read.receiptJSON).providerSnapshot).toEqual(h.response);
    expect(
      (
        await h.t.query(h.readAttempt, {
          operationId: h.created.operationId,
          attemptId: h.acquired.reservation.attemptId,
        })
      ).events,
    ).toHaveLength(2);
    expect(await h.t.mutation(h.retain, h.retainArgs)).toEqual(retained);
    expect(h.fetches()).toBe(0);
  },
);
