import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalConfigure,
  configureComponentFixture,
} from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
async function reserveConfigure() {
  const h = await configureComponentFixture();
  const created = await h.t.mutation(h.create, h.createArgs);
  expect(created.status).toBe("created");
  const reserveArgs = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "configure",
    expectedRequestBinding: h.request.requestIdentity.binding,
    recordJSON: h.createArgs.recordJSON,
  };
  const acquired = await h.t.mutation(h.reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  return {
    ...h,
    created,
    acquired,
    reserveArgs,
    bindArgs: {
      operationId: created.operationId,
      attemptId: acquired.reservation.attemptId,
      policyJSON: canonicalConfigure(h.record.timingPolicy),
      basisJSON: canonicalConfigure(h.basis),
    },
  };
}
it("reserves a distinct configure attempt and binds exactly the parent basis with configure stage", async () => {
  const h = await reserveConfigure();
  expect(h.acquired.reservation.stage).toBe("configure");
  expect(h.acquired.reservation.attemptId).not.toBe(
    h.record.parentAttachment.attemptId,
  );
  expect((await h.t.mutation(h.reserve, h.reserveArgs)).disposition).toBe(
    "existing",
  );
  const bound = await h.t.mutation(h.bind, h.bindArgs);
  expect(bound.initialBasis).toEqual({
    version: 1,
    stage: "configure",
    attemptId: h.acquired.reservation.attemptId,
    sourcePayloadId: h.acquired.reservation.payloadId,
    policyJSON: h.bindArgs.policyJSON,
    basisJSON: h.bindArgs.basisJSON,
  });
  expect(await h.t.mutation(h.bind, h.bindArgs)).toEqual(bound);
  expect(
    (await h.t.query(h.load, { operationId: h.created.operationId }))
      .initialBasis,
  ).toEqual(bound.initialBasis);
  expect(h.fetches()).toBe(0);
});
it("refuses a mathematically valid shifted basis instead of renewing the parent origin", async () => {
  const h = await reserveConfigure();
  const shifted = {
    ...h.basis,
    startWallMs: h.basis.startWallMs + 1,
    startNsDecimal: String(BigInt(h.basis.startNsDecimal) + 1000000n),
  };
  await expect(
    h.t.mutation(h.bind, {
      ...h.bindArgs,
      basisJSON: canonicalConfigure(shifted),
    }),
  ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
  expect(
    (await h.t.query(h.load, { operationId: h.created.operationId }))
      .initialBasis,
  ).toBeNull();
  expect(h.fetches()).toBe(0);
});
