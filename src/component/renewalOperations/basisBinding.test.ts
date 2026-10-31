import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import {
  canonical,
  codecFixture,
  componentFixture,
  create,
  load,
  VALUE_LIMIT,
} from "./timingPolicy.fixtures.js";

const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
const bind = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:bindInitialBasis",
);
// Fixed synthetic DATA, not a sampled runtime clock or an eligibility claim.
const basis = Object.freeze({
  startWallMs: 1700000001000,
  startNsDecimal: "1000000000",
  workEndWallMs: 1700000005000,
  workEndNsDecimal: "5000000000",
  endWallMs: 1700000006000,
  endNsDecimal: "6000000000",
});
afterEach(() => vi.unstubAllGlobals());

it("BIND01 retains exact first basis DATA on the actual reserved V2 operation", async () => {
  const h = await codecFixture();
  const { t, physical } = componentFixture();
  expect(basis.workEndWallMs).toBe(h.record.timingPolicy.workEndWallMs);
  expect(basis.endWallMs).toBe(h.record.timingPolicy.endWallMs);
  expect(BigInt(basis.workEndNsDecimal)).toBe(
    BigInt(basis.startNsDecimal) +
      BigInt(basis.workEndWallMs - basis.startWallMs) * 1000000n,
  );
  expect(BigInt(basis.endNsDecimal)).toBe(
    BigInt(basis.startNsDecimal) +
      BigInt(basis.endWallMs - basis.startWallMs) * 1000000n,
  );
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const createArgs = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(createArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const created = await t.mutation(create, createArgs);
  expect(created.status).toBe("created");
  expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
  const queryArgs = { operationId: created.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(await t.query(load, queryArgs)).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 0,
    activeAttempt: null,
    initialBasis: null,
  });
  const reserveArgs = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.record.requestBinding,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(reserveArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toHaveLength(1);
  expect(before.payloads).toHaveLength(1);
  expect(before.events).toHaveLength(0);
  const operation = before.operations[0];
  const attempt = before.attempts[0];
  const payload = before.payloads[0];
  expect(operation).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    payloadId: payload._id,
    requestBinding: h.record.requestBinding,
    revision: 1,
    state: "RESERVED",
    activeAttemptId: attempt._id,
  });
  expect(Object.prototype.hasOwnProperty.call(operation, "initialBasis")).toBe(
    false,
  );
  expect(payload).toMatchObject({
    codecVersion: 1,
    json: h.recordJSON,
    owner: { kind: "operation", operationId: created.operationId },
  });
  const summary = {
    recordVersion: 2,
    operationId: created.operationId,
    payloadId: payload._id,
    authorizationScope: h.record.authorization.scope,
    authorizationId: h.record.authorization.id,
    authorizationRevision: h.record.authorization.revision,
    logicalOperationId: h.record.logicalOperationId,
    requestBinding: h.record.requestBinding,
    stage: "attach",
    key: h.request.key,
    apiVersion: h.request.apiVersion,
    accountJSON: canonical(h.record.account),
    timingPolicyJSON: canonical(h.record.timingPolicy),
    firstDispatchedAt: h.request.firstDispatchedAt,
    ordinal: 1,
    preparedRevision: 0,
    committedRevision: 1,
    attemptId: attempt._id,
  };
  expect(acquired).toEqual({
    disposition: "acquired",
    previousRevision: 0,
    committedRevision: 1,
    reservation: { ...summary, recordJSON: h.recordJSON },
  });
  const { attemptId, ...fields } = summary;
  expect(attempt).toEqual({
    ...fields,
    _id: attemptId,
    _creationTime: attempt._creationTime,
    lastSequence: 0,
  });
  const reserved = await t.query(load, queryArgs);
  expect(reserved).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 1,
    activeAttempt: summary,
    initialBasis: null,
  });
  expect(getConvexSize(reserved)).toBeLessThanOrEqual(VALUE_LIMIT);
  for (const rows of Object.values(before)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  const args = {
    operationId: created.operationId,
    attemptId: attempt._id,
    policyJSON: canonical(h.record.timingPolicy),
    basisJSON: canonical(basis),
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const initialBasis = {
    version: 1,
    attemptId: attempt._id,
    sourcePayloadId: payload._id,
    stage: "attach",
    policyJSON: args.policyJSON,
    basisJSON: args.basisJSON,
  };
  let stable = before;
  let targetFailed = false;
  try {
    // The registered route exists; only its honest null behavior is missing.
    const result = await t.mutation(bind, args);
    expect(result).toEqual({
      status: "bound",
      operationId: created.operationId,
      initialBasis,
    });
    expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
    const after = await physical();
    stable = after;
    expect(after).toEqual({
      ...before,
      operations: [{ ...operation, initialBasis }],
    });
    for (const rows of Object.values(after)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const loaded = await t.query(load, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({ ...reserved, initialBasis });
    expect(canonical(h.record)).toBe(h.recordJSON);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      const after = await physical();
      console.info(
        "BIND01_SETTLEMENT",
        JSON.stringify({
          physicalEqual: JSON.stringify(after) === JSON.stringify(stable),
          rows: Object.fromEntries(
            Object.entries(after).map(([key, rows]) => [key, rows.length]),
          ),
          fetchCalls: h.fetchCalls(),
        }),
      );
      expect(after).toEqual(stable);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("BIND01_READONLY_INSPECTION_FAILED");
    }
  }
});

// Every recipe is predeclared unsigned host DATA, not a live clock/basis claim.
const missingField: Record<string, unknown> = { ...basis };
delete missingField.endNsDecimal;
const highPrecisionBasis = Object.freeze({
  ...basis,
  startNsDecimal: "9223372036854775809",
  workEndNsDecimal: "9223372040854775809",
  endNsDecimal: "9223372041854775809",
});
const invalidBases = [
  { name: "missing-field", data: missingField },
  { name: "extra-field", data: { ...basis, extra: null } },
  { name: "null-basis", data: null },
  { name: "null-field", data: { ...basis, startNsDecimal: null } },
  { name: "leading-zero", data: { ...basis, startNsDecimal: "01000000000" } },
  { name: "negative-decimal", data: { ...basis, startNsDecimal: "-1" } },
  { name: "fraction-decimal", data: { ...basis, startNsDecimal: "1.5" } },
  { name: "nonstring-decimal", data: { ...basis, startNsDecimal: 1000000000 } },
  {
    name: "u64-overflow",
    data: {
      ...basis,
      startNsDecimal: "18446744073709551616",
      workEndNsDecimal: "18446744077709551616",
      endNsDecimal: "18446744078709551616",
    },
  },
  { name: "unsafe-wall", data: { ...basis, startWallMs: 9007199254740992 } },
  {
    name: "fractional-wall",
    data: {
      ...basis,
      startWallMs: 1700000001000.5,
      workEndNsDecimal: "4999500000",
      endNsDecimal: "5999500000",
    },
  },
  { name: "negative-wall", data: { ...basis, startWallMs: -1 } },
  {
    name: "start-equals-work",
    data: {
      ...basis,
      startWallMs: 1700000005000,
      workEndNsDecimal: "1000000000",
      endNsDecimal: "2000000000",
    },
  },
  {
    name: "different-policy-work",
    data: {
      ...basis,
      workEndWallMs: 1700000005001,
      workEndNsDecimal: "5001000000",
    },
  },
  {
    name: "different-policy-end",
    data: { ...basis, endWallMs: 1700000006001, endNsDecimal: "6001000000" },
  },
  {
    name: "wrong-ns-projection",
    data: { ...basis, workEndNsDecimal: "5000000001" },
  },
  {
    name: "high-precision-projection",
    data: { ...highPrecisionBasis, workEndNsDecimal: "9223372040854775810" },
  },
] as const;

async function reservedForBasis() {
  const h = await codecFixture();
  const { t, physical } = componentFixture();
  expect(basis.workEndWallMs).toBe(h.record.timingPolicy.workEndWallMs);
  expect(basis.endWallMs).toBe(h.record.timingPolicy.endWallMs);
  expect(BigInt(basis.workEndNsDecimal)).toBe(
    BigInt(basis.startNsDecimal) +
      BigInt(basis.workEndWallMs - basis.startWallMs) * 1000000n,
  );
  expect(BigInt(basis.endNsDecimal)).toBe(
    BigInt(basis.startNsDecimal) +
      BigInt(basis.endWallMs - basis.startWallMs) * 1000000n,
  );
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const createArgs = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(createArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const created = await t.mutation(create, createArgs);
  expect(created.status).toBe("created");
  expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
  const queryArgs = { operationId: created.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(await t.query(load, queryArgs)).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 0,
    activeAttempt: null,
    initialBasis: null,
  });
  const reserveArgs = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.record.requestBinding,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(reserveArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toHaveLength(1);
  expect(before.payloads).toHaveLength(1);
  expect(before.events).toHaveLength(0);
  const operation = before.operations[0];
  const attempt = before.attempts[0];
  const payload = before.payloads[0];
  expect(operation).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    payloadId: payload._id,
    requestBinding: h.record.requestBinding,
    revision: 1,
    state: "RESERVED",
    activeAttemptId: attempt._id,
  });
  expect(Object.prototype.hasOwnProperty.call(operation, "initialBasis")).toBe(
    false,
  );
  expect(payload).toMatchObject({
    codecVersion: 1,
    json: h.recordJSON,
    owner: { kind: "operation", operationId: created.operationId },
  });
  const summary = {
    recordVersion: 2,
    operationId: created.operationId,
    payloadId: payload._id,
    authorizationScope: h.record.authorization.scope,
    authorizationId: h.record.authorization.id,
    authorizationRevision: h.record.authorization.revision,
    logicalOperationId: h.record.logicalOperationId,
    requestBinding: h.record.requestBinding,
    stage: "attach",
    key: h.request.key,
    apiVersion: h.request.apiVersion,
    accountJSON: canonical(h.record.account),
    timingPolicyJSON: canonical(h.record.timingPolicy),
    firstDispatchedAt: h.request.firstDispatchedAt,
    ordinal: 1,
    preparedRevision: 0,
    committedRevision: 1,
    attemptId: attempt._id,
  };
  expect(acquired).toEqual({
    disposition: "acquired",
    previousRevision: 0,
    committedRevision: 1,
    reservation: { ...summary, recordJSON: h.recordJSON },
  });
  const { attemptId, ...fields } = summary;
  expect(attempt).toEqual({
    ...fields,
    _id: attemptId,
    _creationTime: attempt._creationTime,
    lastSequence: 0,
  });
  const reserved = await t.query(load, queryArgs);
  expect(reserved).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 1,
    activeAttempt: summary,
    initialBasis: null,
  });
  expect(getConvexSize(reserved)).toBeLessThanOrEqual(VALUE_LIMIT);
  for (const rows of Object.values(before)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  const args = {
    operationId: created.operationId,
    attemptId: attempt._id,
    policyJSON: canonical(h.record.timingPolicy),
    basisJSON: canonical(basis),
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  return { h, t, physical, before, args };
}

it.each(invalidBases)(
  "BIND02 refuses malformed six-field $name basis DATA",
  async (scenario) => {
    if (scenario.name === "high-precision-projection") {
      expect(BigInt(highPrecisionBasis.workEndNsDecimal)).toBe(
        BigInt(highPrecisionBasis.startNsDecimal) +
          BigInt(basis.workEndWallMs - basis.startWallMs) * 1000000n,
      );
      expect(BigInt(highPrecisionBasis.endNsDecimal)).toBe(
        BigInt(highPrecisionBasis.startNsDecimal) +
          BigInt(basis.endWallMs - basis.startWallMs) * 1000000n,
      );
      expect(BigInt(scenario.data.workEndNsDecimal)).toBe(
        BigInt(highPrecisionBasis.workEndNsDecimal) + 1n,
      );
      expect(BigInt(scenario.data.endNsDecimal)).toBe(
        BigInt(highPrecisionBasis.endNsDecimal),
      );
    }
    if (
      scenario.name === "leading-zero" ||
      scenario.name === "u64-overflow" ||
      scenario.name === "start-equals-work" ||
      scenario.name === "different-policy-work" ||
      scenario.name === "different-policy-end"
    ) {
      // These cases deliberately preserve the complete numerical projection.
      const data = scenario.data;
      expect(BigInt(data.workEndNsDecimal)).toBe(
        BigInt(data.startNsDecimal) +
          BigInt(data.workEndWallMs - data.startWallMs) * 1000000n,
      );
      expect(BigInt(data.endNsDecimal)).toBe(
        BigInt(data.startNsDecimal) +
          BigInt(data.endWallMs - data.startWallMs) * 1000000n,
      );
    }
    const { h, t, physical, before, args } = await reservedForBasis();
    const basisJSON = canonical(scenario.data);
    expect(basisJSON.length).toBeLessThanOrEqual(500000);
    expect(new TextEncoder().encode(basisJSON).length).toBeLessThanOrEqual(
      500000,
    );
    const invalidArgs = { ...args, basisJSON };
    expect(getConvexSize(invalidArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    let targetFailed = false;
    try {
      await expect(t.mutation(bind, invalidArgs)).rejects.toThrow(
        /^RENEWAL_JOURNAL_CONFLICT$/,
      );
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        const after = await physical();
        console.info(
          "BIND02_SETTLEMENT",
          JSON.stringify({
            scenario: scenario.name,
            physicalEqual: JSON.stringify(after) === JSON.stringify(before),
            rows: Object.fromEntries(
              Object.entries(after).map(([key, rows]) => [key, rows.length]),
            ),
            fetchCalls: h.fetchCalls(),
          }),
        );
        expect(after).toEqual(before);
        expect(h.fetchCalls()).toBe(0);
      } catch (inspectionError) {
        if (!targetFailed) throw inspectionError;
        console.info("BIND02_READONLY_INSPECTION_FAILED");
      }
    }
  },
);

it("BIND03 retains exact valid u64 projection above Number precision", async () => {
  // Pure unsigned DATA arithmetic before actual constructors; no clock sample.
  expect(BigInt(highPrecisionBasis.startNsDecimal)).toBeGreaterThan(
    9007199254740991n,
  );
  expect(BigInt(highPrecisionBasis.workEndNsDecimal)).toBe(
    BigInt(highPrecisionBasis.startNsDecimal) +
      BigInt(
        highPrecisionBasis.workEndWallMs - highPrecisionBasis.startWallMs,
      ) *
        1000000n,
  );
  expect(BigInt(highPrecisionBasis.endNsDecimal)).toBe(
    BigInt(highPrecisionBasis.startNsDecimal) +
      BigInt(highPrecisionBasis.endWallMs - highPrecisionBasis.startWallMs) *
        1000000n,
  );
  const { h, t, physical, before, args } = await reservedForBasis();
  const basisJSON = canonical(highPrecisionBasis);
  const highArgs = { ...args, basisJSON };
  expect(getConvexSize(highArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const queryArgs = { operationId: args.operationId };
  const reserved = await t.query(load, queryArgs);
  expect(reserved.initialBasis).toBeNull();
  expect(getConvexSize(reserved)).toBeLessThanOrEqual(VALUE_LIMIT);
  const initialBasis = {
    version: 1,
    attemptId: args.attemptId,
    sourcePayloadId: before.payloads[0]._id,
    stage: "attach",
    policyJSON: args.policyJSON,
    basisJSON,
  };
  let stable = before;
  let targetFailed = false;
  try {
    const result = await t.mutation(bind, highArgs);
    expect(result).toEqual({
      status: "bound",
      operationId: args.operationId,
      initialBasis,
    });
    expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
    const after = await physical();
    stable = after;
    expect(after).toEqual({
      ...before,
      operations: [{ ...before.operations[0], initialBasis }],
    });
    for (const rows of Object.values(after)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const loaded = await t.query(load, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({ ...reserved, initialBasis });
    expect(JSON.parse(loaded.initialBasis.basisJSON)).toEqual(
      highPrecisionBasis,
    );
    expect(canonical(h.record)).toBe(h.recordJSON);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(stable);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("BIND03_READONLY_INSPECTION_FAILED");
    }
  }
});
