import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../test.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import {
  eventDigest,
  materialize,
  objectNode,
  scalarNode,
} from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";

const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
const append = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:appendStageEvent",
);
const read = makeFunctionReference<"query">(
  "renewalOperations/queries:readAttempt",
);

// Storage DATA only. This declaration is not a qualified C1/C2/Owner/ACK fixture.
export const originalRecord = Object.freeze({
  schemaVersion: 1,
  requestBinding: "journal-consistency-fixture-A",
  authorization: Object.freeze({
    scope: "merchant-A",
    id: "consent-A",
    revision: 1,
  }),
  logicalOperationId: "replacement-A",
  stage: "attach",
  account: Object.freeze({
    mode: "platform",
    stripeAccount: null,
    livemode: false,
  }),
  apiVersion: "2026-09-30.endive",
  profile: "renewal-fixture-no-operational-authority",
  subscriptionId: "sub_A",
  customerId: "cus_A",
  itemId: "si_A",
  currentPriceId: "price_old",
  targetPriceId: "price_new",
  targetProductId: "prod_new",
  period: Object.freeze({ start: 2000000000, end: 2000003600 }),
  dispatch: Object.freeze({
    scope: "platform",
    apiVersion: "2026-09-30.endive",
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: Object.freeze({ from_subscription: "sub_A" }),
    key: "retained-attach-A",
    firstDispatchedAt: 2000000000,
  }),
  options: Object.freeze({ maxNetworkRetries: 0, redirect: "error" }),
  originalBundle: Object.freeze({
    subscription: Object.freeze({
      id: "sub_A",
      schedule: null,
      metadata: Object.freeze({ original: "retained" }),
    }),
    targetPrice: Object.freeze({ id: "price_new", product: "prod_new" }),
  }),
  basis: Object.freeze({
    startWallMs: 2000000000000,
    startNs: "1000000000",
    workEndWallMs: 2000000004000,
    workEndNs: "5000000000",
    endWallMs: 2000000005000,
    endNs: "6000000000",
  }),
});
const originalJSON = JSON.stringify(renewalSnapshot(originalRecord));
const creation = Object.freeze({
  authorizationScope: "merchant-A",
  logicalOperationId: "replacement-A",
  authorizationRevision: 1,
  recordJSON: originalJSON,
});
const expectedBinding = originalRecord.requestBinding;
const failFetch = () => {
  throw Error("UNEXPECTED_EXTERNAL_FETCH");
};
afterEach(() => vi.unstubAllGlobals());
function isolated() {
  vi.stubGlobal("fetch", failFetch);
  return convexTest(schema, modules);
}

it("J01 retains the complete original record when duplicate identity conflicts", async () => {
  const t = isolated();
  const created = await t.mutation(create, creation);
  expect(created.status).toBe("created");
  const before = await t.query(load, { operationId: created.operationId });
  expect(before.recordJSON).toBe(originalJSON);
  expect(before.revision).toBe(0);
  const duplicate = await t.mutation(create, creation);
  expect(duplicate).toEqual({
    status: "existing",
    operationId: created.operationId,
  });
  const reorderedJSON = JSON.stringify(
    Object.fromEntries(Object.entries(originalRecord).reverse()),
  );
  expect(reorderedJSON).not.toBe(originalJSON);
  expect(JSON.parse(reorderedJSON)).toEqual(originalRecord);
  const reorderedDuplicate = await t.mutation(create, {
    ...creation,
    recordJSON: reorderedJSON,
  });
  expect(reorderedDuplicate).toEqual({
    status: "existing",
    operationId: created.operationId,
  });
  expect(await t.query(load, { operationId: created.operationId })).toEqual(
    before,
  );
  const conflictingRecord = JSON.stringify(
    renewalSnapshot({
      ...originalRecord,
      dispatch: { ...originalRecord.dispatch, key: "different-key" },
    }),
  );
  const conflicting = await t.mutation(create, {
    ...creation,
    recordJSON: conflictingRecord,
  });
  expect(conflicting).toEqual({
    status: "conflict",
    reason: "identity_changed",
  });
  expect(await t.query(load, { operationId: created.operationId })).toEqual(
    before,
  );
  expect(JSON.parse(before.recordJSON)).toEqual(originalRecord);
});

it("J02 concurrent PREPARED CAS has only one fresh acquired reply", async () => {
  const t = isolated();
  const op = await t.mutation(create, creation);
  expect(op.status).toBe("created");
  const retained = await t.query(load, { operationId: op.operationId });
  expect(retained.recordJSON).toBe(originalJSON);
  expect(retained.revision).toBe(0);
  const args = {
    operationId: op.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: expectedBinding,
    recordJSON: originalJSON,
  };
  const replies = await Promise.all([
    t.mutation(reserve, args),
    t.mutation(reserve, args),
  ]);
  const acquired = replies.filter((r) => r.disposition === "acquired");
  const existing = replies.filter((r) => r.disposition === "existing");
  expect(acquired).toHaveLength(1);
  expect(existing).toHaveLength(1);
  expect(existing[0].reservation).toEqual(acquired[0].reservation);
  expect(acquired[0].previousRevision).toBe(0);
  expect(acquired[0].committedRevision).toBe(1);
  const again = await t.mutation(reserve, args);
  expect(again.disposition).toBe("existing");
  expect(again.reservation).toEqual(acquired[0].reservation);
  const saved = await t.query(load, { operationId: op.operationId });
  expect(saved.recordJSON).toBe(originalJSON);
  expect(saved.revision).toBe(1);
  const { recordJSON: acquiredRecordJSON, ...expectedSummary } =
    acquired[0].reservation;
  expect(acquiredRecordJSON).toBe(originalJSON);
  expect(Object.keys(expectedSummary)).toHaveLength(17);
  expect(saved.activeAttempt).toEqual(expectedSummary);
  expect(
    Object.prototype.hasOwnProperty.call(saved.activeAttempt, "recordJSON"),
  ).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(saved, "acquired")).toBe(false);
  expect(
    Object.prototype.hasOwnProperty.call(saved.activeAttempt, "acquired"),
  ).toBe(false);
});

it.each([
  [
    "key",
    {
      ...originalRecord,
      dispatch: { ...originalRecord.dispatch, key: "other" },
    },
  ],
  [
    "account",
    {
      ...originalRecord,
      account: {
        mode: "connected",
        stripeAccount: "acct_other",
        livemode: false,
      },
    },
  ],
  ["api", { ...originalRecord, apiVersion: "different-api" }],
  ["presence", { ...originalRecord, default_settings: null }],
])(
  "J03 rejects changed complete %s before a reservation",
  async (_name, changed) => {
    const t = isolated();
    const op = await t.mutation(create, creation);
    expect(op.status).toBe("created");
    const before = await t.query(load, { operationId: op.operationId });
    expect(before.recordJSON).toBe(originalJSON);
    expect(before.revision).toBe(0);
    expect(before.activeAttempt).toBeNull();
    const result = await t.mutation(reserve, {
      operationId: op.operationId,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: expectedBinding,
      recordJSON: JSON.stringify(renewalSnapshot(changed)),
    });
    expect(result).toEqual({
      disposition: "conflict",
      reason: "identity_changed",
    });
    const saved = await t.query(load, { operationId: op.operationId });
    expect(saved.revision).toBe(0);
    expect(saved.activeAttempt).toBeNull();
    expect(saved.recordJSON).toBe(originalJSON);
    expect(saved).toEqual(before);
  },
);

it("J03b same complete record with wrong binding cannot acquire a reservation", async () => {
  const t = isolated();
  const op = await t.mutation(create, creation);
  expect(op.status).toBe("created");
  const before = await t.query(load, { operationId: op.operationId });
  expect(before.recordJSON).toBe(originalJSON);
  expect(before.revision).toBe(0);
  expect(before.activeAttempt).toBeNull();
  const refused = await t.mutation(reserve, {
    operationId: op.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: "different-binding",
    recordJSON: originalJSON,
  });
  expect(refused).toEqual({
    disposition: "conflict",
    reason: "identity_changed",
  });
  expect(await t.query(load, { operationId: op.operationId })).toEqual(before);
});

it("J04 stage append is idempotent and conflicting duplicate never overwrites", async () => {
  const t = isolated();
  const op = await t.mutation(create, creation);
  expect(op.status).toBe("created");
  const retained = await t.query(load, { operationId: op.operationId });
  expect(retained.recordJSON).toBe(originalJSON);
  expect(retained.revision).toBe(0);
  expect(retained.activeAttempt).toBeNull();
  const acquired = await t.mutation(reserve, {
    operationId: op.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: expectedBinding,
    recordJSON: originalJSON,
  });
  expect(acquired.disposition).toBe("acquired");
  const dataNode = objectNode([
    ["event", scalarNode("dispatch")],
    [
      "request",
      objectNode([
        ["scope", scalarNode(originalRecord.dispatch.scope)],
        ["apiVersion", scalarNode(originalRecord.dispatch.apiVersion)],
        ["method", scalarNode(originalRecord.dispatch.method)],
        ["path", scalarNode(originalRecord.dispatch.path)],
        [
          "payload",
          objectNode([
            [
              "from_subscription",
              scalarNode(originalRecord.dispatch.payload.from_subscription),
            ],
          ]),
        ],
        ["key", scalarNode(originalRecord.dispatch.key)],
        [
          "firstDispatchedAt",
          scalarNode(originalRecord.dispatch.firstDispatchedAt),
        ],
      ]),
    ],
  ]);
  const expectedData = { event: "dispatch", request: originalRecord.dispatch };
  expect(materialize(dataNode)).toEqual(expectedData);
  const binding = await eventDigest(
    objectNode([
      ["sequence", scalarNode(1)],
      ["data", dataNode],
    ]),
  );
  expect(binding).toMatch(
    /^unbound-qualification-event:v2:sha256:[0-9a-f]{64}$/,
  );
  const event = {
    reservation: acquired.reservation,
    expectedSequence: 0,
    event: {
      sequence: 1,
      binding,
      dataJSON: JSON.stringify(renewalSnapshot(expectedData)),
    },
  };
  const first = await t.mutation(append, event);
  expect(first.sequence).toBe(1);
  expect(first.binding).toBe(event.event.binding);
  expect(await t.mutation(append, event)).toEqual(first);
  const before = await t.query(read, {
    operationId: op.operationId,
    attemptId: acquired.reservation.attemptId,
  });
  await expect(
    t.mutation(append, {
      ...event,
      event: {
        ...event.event,
        dataJSON: JSON.stringify({ event: "dispatch", wrong: true }),
      },
    }),
  ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
  expect(
    await t.query(read, {
      operationId: op.operationId,
      attemptId: acquired.reservation.attemptId,
    }),
  ).toEqual(before);
  expect(before.events).toHaveLength(1);
  expect(
    Object.prototype.hasOwnProperty.call(before.events[0], "dataJSON"),
  ).toBe(false);
  const { reservation: receiptReservation, ...descriptor } = first;
  expect(receiptReservation).toEqual(acquired.reservation);
  expect(before.reservation).toEqual(acquired.reservation);
  expect(before.events[0]).toEqual(descriptor);
});

// Genuine C9/full18/19 retention, publication failure and ancestor closure require
// the later actual-ACK fixture. No synthetic DTO is called an actual provider ACK.

// Large unqualified storage DATA: valid individual values must remain readable.
it("H01 three full events have a bounded descriptor-only history manifest", async () => {
  const limit = 1048576;
  const recipe = Object.freeze([1, 2, 3] as const);
  const padding = "h".repeat(380000);
  const events = recipe.map((sequence) =>
    Object.freeze({
      sequence,
      data: Object.freeze({
        event: "unqualified-storage-history",
        sequence,
        padding,
      }),
    }),
  );
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  const t = convexTest(schema, modules);
  function fits(value: Parameters<typeof getConvexSize>[0]) {
    expect(getConvexSize(value) <= limit).toBe(true);
  }
  fits(creation);
  const op = await t.mutation(create, creation);
  expect(op.status).toBe("created");
  fits(op);
  const loadArgs = { operationId: op.operationId };
  fits(loadArgs);
  const loaded = await t.query(load, loadArgs);
  fits(loaded);
  expect(loaded.recordJSON).toBe(originalJSON);
  expect(loaded.revision).toBe(0);
  expect(loaded.activeAttempt).toBeNull();
  const reserveArgs = {
    operationId: op.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: expectedBinding,
    recordJSON: originalJSON,
  };
  fits(reserveArgs);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  fits(acquired);
  expect(acquired.reservation.recordJSON).toBe(originalJSON);
  expect(acquired.reservation.basisJSON).toBe(
    JSON.stringify(renewalSnapshot(originalRecord.basis)),
  );
  const readArgs = {
    operationId: op.operationId,
    attemptId: acquired.reservation.attemptId,
  };
  fits(readArgs);
  const descriptors: Record<string, string | number>[] = [];
  const eventJSONs: string[] = [];
  for (const { sequence, data } of events) {
    const dataJSON = JSON.stringify(renewalSnapshot(data));
    expect(dataJSON.length <= 500000).toBe(true);
    expect(new TextEncoder().encode(dataJSON).length <= 500000).toBe(true);
    const node = objectNode([
      ["event", scalarNode(data.event)],
      ["sequence", scalarNode(sequence)],
      ["padding", scalarNode(padding)],
    ]);
    expect(materialize(node)).toEqual(data);
    const binding = await eventDigest(
      objectNode([
        ["sequence", scalarNode(sequence)],
        ["data", node],
      ]),
    );
    expect(binding).toMatch(
      /^unbound-qualification-event:v2:sha256:[0-9a-f]{64}$/,
    );
    const args = {
      reservation: acquired.reservation,
      expectedSequence: sequence - 1,
      event: { sequence, binding, dataJSON },
    };
    fits(args);
    const receipt = await t.mutation(append, args);
    fits(receipt);
    expect(receipt.sequence).toBe(sequence);
    expect(receipt.binding).toBe(binding);
    expect(receipt.reservation).toEqual(acquired.reservation);
    const { reservation: unusedReservation, ...descriptor } = receipt;
    void unusedReservation;
    descriptors.push(descriptor);
    eventJSONs.push(dataJSON);
    if (sequence < 3) {
      const prior = await t.query(read, readArgs);
      fits(prior);
      expect(prior.reservation).toEqual(acquired.reservation);
      expect(
        prior.events.map((event: { sequence: number }) => event.sequence),
      ).toEqual(recipe.slice(0, sequence));
    }
  }
  // Each physical read returns a bounded value. Payload JSONs are joined only
  // in test memory; no prerequisite returns all large payloads in one RPC.
  async function physical() {
    const operations = await t.run((ctx) =>
      ctx.db.query("renewalOperations").take(3),
    );
    const attempts = await t.run((ctx) =>
      ctx.db.query("renewalOperationAttempts").take(3),
    );
    const storedEvents = await t.run((ctx) =>
      ctx.db.query("renewalOperationEvents").take(4),
    );
    const payloadIds = await t.run(async (ctx) =>
      (await ctx.db.query("renewalOperationPayloads").take(5)).map(
        (row) => row._id,
      ),
    );
    for (const reply of [operations, attempts, storedEvents, payloadIds])
      fits(reply);
    const payloads = [];
    for (const id of payloadIds) {
      const row = await t.run((ctx) =>
        ctx.db.get("renewalOperationPayloads", id),
      );
      expect(row).not.toBeNull();
      if (!row) throw Error("HISTORY_PAYLOAD_MISSING");
      fits(row);
      expect(getDocumentSize(row) <= limit).toBe(true);
      payloads.push(row);
    }
    for (const row of [...operations, ...attempts, ...storedEvents])
      expect(getDocumentSize(row) <= limit).toBe(true);
    expect(operations).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    expect(storedEvents).toHaveLength(3);
    expect(payloads).toHaveLength(4);
    expect(operations[0].state).toBe("RESERVED");
    expect(operations[0].revision).toBe(1);
    expect(attempts[0].lastSequence).toBe(3);
    expect(
      payloads.find((row) => row._id === acquired.reservation.payloadId)?.json,
    ).toBe(originalJSON);
    for (let index = 0; index < descriptors.length; index++) {
      const descriptor = descriptors[index];
      const row = storedEvents.find(
        (candidate) => candidate._id === descriptor.eventId,
      );
      expect(row).toBeDefined();
      if (!row) throw Error("HISTORY_EVENT_MISSING");
      const { _id, _creationTime, ...fields } = row;
      void _creationTime;
      expect({ ...fields, eventId: _id }).toEqual(descriptor);
      expect(row.sequence).toBe(index + 1);
      expect(
        payloads.find((payload) => payload._id === descriptor.payloadId)
          ?.json === eventJSONs[index],
      ).toBe(true);
    }
    return { operations, attempts, storedEvents, payloads };
  }
  const before = await physical();
  const oldFullShape = {
    reservation: acquired.reservation,
    events: descriptors.map((descriptor, index) => ({
      ...descriptor,
      dataJSON: eventJSONs[index],
    })),
  };
  const oldFullBytes = getConvexSize(oldFullShape);
  expect(oldFullBytes > limit).toBe(true);
  let status = "unsettled";
  let resultBytes = -1;
  try {
    const manifest = await t.query(read, readArgs);
    status = "fulfilled";
    resultBytes = getConvexSize(manifest);
    expect(resultBytes <= limit).toBe(true);
    expect(manifest.reservation).toEqual(acquired.reservation);
    expect(manifest.events).toEqual(descriptors);
    expect(
      manifest.events.every(
        (event: object) =>
          !Object.prototype.hasOwnProperty.call(event, "dataJSON"),
      ),
    ).toBe(true);
  } catch (error) {
    if (status === "unsettled") status = "rejected";
    throw error;
  } finally {
    const after = await physical();
    const unchanged = JSON.stringify(after) === JSON.stringify(before);
    console.info(
      "HISTORY_MANIFEST",
      JSON.stringify({
        status,
        resultBytes,
        oldFullBytes,
        unchanged,
        events: 3,
        fetchCalls,
      }),
    );
    expect(unchanged).toBe(true);
    expect(fetchCalls).toBe(0);
  }
});
