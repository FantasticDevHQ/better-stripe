import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import { getConvexSize, getDocumentSize, type ObjectType } from "convex/values";
import type { appendArgs } from "./schema.js";
import {
  prepareAcknowledgementScenario,
  retain,
  append,
  canonical,
  VALUE_LIMIT,
  negativeScenarios,
  type Scenario,
  type RetentionReceipt,
} from "./acknowledgement.fixtures.js";
import { constructRenewalScheduleAttachmentReceiptV2 } from "../../client/billing/renewalV2/index.js";
import { admitInitialOutput } from "../../client/billing/renewalAttach/internal/recovery/material.js";
import { captureAttachReceipt } from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import {
  eventDigest,
  objectNode,
  scalarNode,
  materialize,
} from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";
import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
import { receiptInput } from "../../client/billing/renewalAttach/internal/acquisition/test-fixtures/fixture.mjs";
import type { ConstructRenewalScheduleAttachmentReceiptV2Options } from "../../client/billing/renewalV2/index.js";

afterEach(() => vi.unstubAllGlobals());
async function acknowledgementScenario(scenario: Scenario, duplicate = false) {
  const h = await prepareAcknowledgementScenario(scenario);
  const {
    t,
    physical,
    before,
    args,
    receipt,
    receiptJSON,
    acquired,
    commits,
    ownerScope,
    queryArgs,
    shouldRetain,
    fetchCalls,
  } = h;
  if (!shouldRetain) {
    let fulfilled = false;
    let returnedNull = false;
    let refusal: unknown;
    try {
      const value = await t.mutation(retain, args);
      fulfilled = true;
      returnedNull = value === null;
      expect(getConvexSize(value)).toBeLessThanOrEqual(VALUE_LIMIT);
    } catch (error) {
      refusal = error;
    }
    let after: Awaited<ReturnType<typeof physical>>;
    try {
      after = await physical();
    } catch (inspectionError) {
      if (refusal !== undefined) throw refusal;
      throw inspectionError;
    }
    const physicalEqual = JSON.stringify(after) === JSON.stringify(before);
    console.info(
      "BTS317_ACK_NEGATIVE",
      JSON.stringify({
        scenario,
        fulfilled,
        returnedNull,
        physicalEqual,
        counts: Object.values(after).map((rows) => rows.length),
        lastSequence: after.attempts[0]?.lastSequence,
        fetchCalls: fetchCalls(),
      }),
    );
    // Missing route/import/framework errors must remain original STOP errors.
    if (
      refusal !== undefined &&
      (!(refusal instanceof Error) ||
        refusal.message !== "RENEWAL_JOURNAL_CONFLICT")
    )
      throw refusal;
    expect(fulfilled).toBe(false);
    expect(refusal).toBeInstanceOf(Error);
    expect(physicalEqual).toBe(true);
    expect(Object.values(after).map((rows) => rows.length)).toEqual([
      1, 1, 2, 3,
    ]);
    expect(after.attempts[0].lastSequence).toBe(2);
    expect(fetchCalls()).toBe(0);
    return;
  }
  let retained: RetentionReceipt | null | undefined;
  const inspectSettlement = async () => {
    const rows = await physical();
    console.info(
      "BTS317_ACK01_SETTLEMENT",
      JSON.stringify({
        resultNull: retained === null,
        physicalEqual: JSON.stringify(rows) === JSON.stringify(before),
        counts: Object.values(rows).map((docs) => docs.length),
        lastSequence: rows.attempts[0]?.lastSequence,
        fetchCalls: fetchCalls(),
      }),
    );
    return rows;
  };
  try {
    retained = await t.mutation(retain, args);
  } catch (originalError) {
    try {
      await inspectSettlement();
    } finally {
      throw originalError;
    }
  }
  const after = await inspectSettlement();
  // The intended honest-null RED occurs HERE after every real prerequisite.
  expect(retained).not.toBeNull();
  assert(retained !== null && retained !== undefined);
  expect(getConvexSize(retained)).toBeLessThanOrEqual(VALUE_LIMIT);
  const expectedKnown = {
    schemaVersion: 1,
    stage: "attach",
    attemptId: acquired.reservation.attemptId,
    sourcePayloadId: acquired.reservation.payloadId,
    dispatchEventId: commits[0].eventId,
    dispatchPayloadId: commits[0].payloadId,
    responseEventId: commits[1].eventId,
    responsePayloadId: commits[1].payloadId,
    receiptPayloadId: retained.receiptPayloadId,
    receiptBinding: receipt.binding,
  };
  expect(retained).toEqual({
    status: "retained",
    ...queryArgs,
    ...expectedKnown,
  });
  assert(after);
  expect(Object.values(after).map((rows) => rows.length)).toEqual([1, 1, 2, 4]);
  const known = Object.getOwnPropertyDescriptor(
    after.operations[0],
    "knownAcknowledgement",
  );
  assert(known && "value" in known);
  expect(known.value).toEqual(expectedKnown);
  const storedReceipt = after.payloads.find(
    (row) => row._id === retained.receiptPayloadId,
  );
  assert(storedReceipt);
  expect(storedReceipt.codecVersion).toBe(1);
  expect(storedReceipt.owner).toEqual({ kind: "receipt", ...ownerScope });
  expect(storedReceipt.json).toBe(receiptJSON);
  if (scenario === "nullable-key") {
    const savedMetadata = JSON.parse(storedReceipt.json).providerSnapshot
      .metadata;
    expect(
      Object.prototype.hasOwnProperty.call(savedMetadata, "client_secret"),
    ).toBe(true);
    expect(savedMetadata.client_secret).toBeNull();
  }
  for (const doc of before.payloads)
    expect(after.payloads.find((row) => row._id === doc._id)).toEqual(doc);
  expect(after.attempts).toEqual(before.attempts);
  expect(after.events).toEqual(before.events);
  expect(
    Object.fromEntries(
      Object.entries(after.operations[0]).filter(
        ([key]) => key !== "knownAcknowledgement",
      ),
    ),
  ).toEqual(before.operations[0]);
  for (const rows of Object.values(after))
    for (const doc of rows)
      expect(getDocumentSize(doc)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(fetchCalls()).toBe(0);
  if (duplicate) {
    try {
      expect(await t.mutation(retain, args)).toEqual(retained);
    } finally {
      expect(await physical()).toEqual(after);
      expect(fetchCalls()).toBe(0);
    }
  }
  return { ...h, retained, after };
}

it("ACK01 retains full known attach receipt before receipt3 publication", async () => {
  await acknowledgementScenario("clean");
});
it("ACK-null explicit null credential field is retained without becoming absent", async () => {
  await acknowledgementScenario("nullable-key");
});
it.each(negativeScenarios)(
  "ACK-negative %s refuses invalid host DATA before retention writes",
  async (scenario) => {
    await acknowledgementScenario(scenario);
  },
);

it("ACK02 identical retain returns the original receipt without writes", async () => {
  await acknowledgementScenario("clean", true);
});

type PreparedACK = Awaited<ReturnType<typeof prepareAcknowledgementScenario>>;
async function thirdEventArgs(
  h: PreparedACK,
  receipt: PreparedACK["receipt"],
): Promise<ObjectType<typeof appendArgs>> {
  const data = {
    event: "receipt",
    stage: "attach",
    request: h.request,
    receipt,
  };
  const node = captureAttachReceipt(data);
  expect(materialize(node)).toEqual(data);
  const full = await canonicalJournalEvent(3, canonical(data));
  expect(full.binding).toBe(
    await eventDigest(
      objectNode([
        ["sequence", scalarNode(3)],
        ["data", node],
      ]),
    ),
  );
  const args: ObjectType<typeof appendArgs> = {
    reservation: h.acquired.reservation,
    expectedSequence: 2,
    event: { sequence: 3, binding: full.binding, dataJSON: full.json },
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  return args;
}

it("ACK03 first retain after matching event3 is stable on identical retry", async () => {
  const h = await prepareAcknowledgementScenario("clean");
  const eventArgs = await thirdEventArgs(h, h.receipt);
  const committed = await h.t.mutation(append, eventArgs);
  expect(committed.sequence).toBe(3);
  expect(committed.binding).toBe(eventArgs.event.binding);
  expect(committed.reservation).toEqual(h.acquired.reservation);
  expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await h.physical();
  expect(Object.values(before).map((rows) => rows.length)).toEqual([
    1, 1, 3, 4,
  ]);
  expect(before.attempts[0].lastSequence).toBe(3);
  for (const rows of Object.values(before))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(
    Object.prototype.hasOwnProperty.call(
      before.operations[0],
      "knownAcknowledgement",
    ),
  ).toBe(false);
  expect(
    before.payloads.find((row) => row._id === committed.payloadId),
  ).toMatchObject({
    codecVersion: 1,
    json: eventArgs.event.dataJSON,
    owner: { kind: "event", ...h.ownerScope, sequence: 3 },
  });
  for (const row of h.before.payloads)
    expect(
      before.payloads.find((candidate) => candidate._id === row._id),
    ).toEqual(row);
  for (const row of h.before.events)
    expect(
      before.events.find((candidate) => candidate._id === row._id),
    ).toEqual(row);
  const args = { ...h.args, expectedSequence: 3 as const };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  let retained: RetentionReceipt | null | undefined;
  try {
    retained = await h.t.mutation(retain, args);
  } catch (originalError) {
    try {
      const rows = await h.physical();
      const physicalEqual = JSON.stringify(rows) === JSON.stringify(before);
      console.info(
        "ACK03_FIRST_SETTLEMENT",
        JSON.stringify({
          physicalEqual,
          counts: Object.values(rows).map((group) => group.length),
          fetchCalls: h.fetchCalls(),
        }),
      );
      expect(physicalEqual).toBe(true);
      expect(h.fetchCalls()).toBe(0);
    } finally {
      throw originalError;
    }
  }
  assert(retained !== null && retained !== undefined);
  expect(getConvexSize(retained)).toBeLessThanOrEqual(VALUE_LIMIT);
  const expectedKnown = {
    schemaVersion: 1,
    stage: "attach",
    attemptId: h.acquired.reservation.attemptId,
    sourcePayloadId: h.acquired.reservation.payloadId,
    dispatchEventId: h.commits[0].eventId,
    dispatchPayloadId: h.commits[0].payloadId,
    responseEventId: h.commits[1].eventId,
    responsePayloadId: h.commits[1].payloadId,
    receiptPayloadId: retained.receiptPayloadId,
    receiptBinding: h.receipt.binding,
  };
  expect(retained).toEqual({
    status: "retained",
    ...h.queryArgs,
    ...expectedKnown,
  });
  const after = await h.physical();
  expect(Object.values(after).map((rows) => rows.length)).toEqual([1, 1, 3, 5]);
  expect(after.operations[0].knownAcknowledgement).toEqual(expectedKnown);
  expect(
    after.payloads.find((row) => row._id === retained.receiptPayloadId),
  ).toMatchObject({
    codecVersion: 1,
    json: h.receiptJSON,
    owner: { kind: "receipt", ...h.ownerScope },
  });
  for (const row of before.payloads)
    expect(
      after.payloads.find((candidate) => candidate._id === row._id),
    ).toEqual(row);
  expect(after.events).toEqual(before.events);
  expect(after.attempts).toEqual(before.attempts);
  expect(
    Object.fromEntries(
      Object.entries(after.operations[0]).filter(
        ([key]) => key !== "knownAcknowledgement",
      ),
    ),
  ).toEqual(before.operations[0]);
  for (const rows of Object.values(after))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  try {
    expect(await h.t.mutation(retain, args)).toEqual(retained);
  } finally {
    expect(await h.physical()).toEqual(after);
    expect(h.fetchCalls()).toBe(0);
  }
});
it("ACK04 matching event3 leaves known receipt and old expectedSequence2 retry stable", async () => {
  const h = await acknowledgementScenario("clean");
  assert(h);
  const eventArgs = await thirdEventArgs(h, h.receipt);
  const committed = await h.t.mutation(append, eventArgs);
  expect(committed.sequence).toBe(3);
  expect(committed.binding).toBe(eventArgs.event.binding);
  expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
  const after3 = await h.physical();
  expect(Object.values(after3).map((rows) => rows.length)).toEqual([
    1, 1, 3, 5,
  ]);
  expect(after3.operations[0].knownAcknowledgement).toEqual(
    h.after.operations[0].knownAcknowledgement,
  );
  expect(after3.attempts[0].lastSequence).toBe(3);
  try {
    for (const expectedSequence of [2, 3] as const) {
      const args = { ...h.args, expectedSequence };
      expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
      expect(await h.t.mutation(retain, args)).toEqual(h.retained);
    }
  } finally {
    expect(await h.physical()).toEqual(after3);
    expect(h.fetchCalls()).toBe(0);
  }
});
function alternateRawRecipe(): ConstructRenewalScheduleAttachmentReceiptV2Options {
  const declared = receiptInput();
  const wire = declared.actualDispatch;
  assert(wire.scope === "platform" && wire.method === "POST");
  assert(wire.path === "/v1/subscription_schedules");
  return {
    attachRequest: declared.attachRequest,
    actualDispatch: {
      scope: wire.scope,
      apiVersion: wire.apiVersion,
      method: wire.method,
      path: wire.path,
      payload: wire.payload,
      key: wire.key,
      firstDispatchedAt: wire.firstDispatchedAt,
    },
    providerSnapshot: {
      ...declared.providerSnapshot,
      metadata: {
        ...declared.providerSnapshot.metadata,
        opaque: "different-full-body",
      },
    },
  };
}
it.each(["derived-other", "copied-known-binding"] as const)(
  "ACK05 %s event3 cannot contradict the already retained whole receipt",
  async (mode) => {
    // The alternate raw response is declared BEFORE all C1/C2/C3 constructors.
    const alternateRaw = alternateRawRecipe();
    const h = await acknowledgementScenario("clean");
    assert(h);
    const alternate =
      await constructRenewalScheduleAttachmentReceiptV2(alternateRaw);
    expect(alternate.request).toEqual(h.request);
    expect(alternate.binding).not.toBe(h.receipt.binding);
    admitInitialOutput(alternate, h.prepared, h.request);
    // Second mode is intentionally invalid host C3 DATA, not a constructor ACK.
    // Its shape/hash capture alone cannot prove the complete receipt relation.
    const candidate =
      mode === "derived-other"
        ? alternate
        : {
            ...alternate,
            binding: h.receipt.binding,
          };
    const eventArgs = await thirdEventArgs(h, candidate);
    const before = await h.physical();
    let targetError: unknown;
    try {
      await expect(h.t.mutation(append, eventArgs)).rejects.toThrow(
        "RENEWAL_JOURNAL_CONFLICT",
      );
    } catch (error) {
      targetError = error;
      throw error;
    } finally {
      try {
        const after = await h.physical();
        const physicalEqual = JSON.stringify(after) === JSON.stringify(before);
        console.info(
          "ACK05_SETTLEMENT",
          JSON.stringify({
            mode,
            physicalEqual,
            counts: Object.values(after).map((rows) => rows.length),
            fetchCalls: h.fetchCalls(),
          }),
        );
        expect(physicalEqual).toBe(true);
        expect(h.fetchCalls()).toBe(0);
      } catch (inspectionError) {
        if (targetError !== undefined) throw targetError;
        throw inspectionError;
      }
    }
  },
);

it("ACK06 a mismatched existing event3 cannot create known retention", async () => {
  const raw = alternateRawRecipe();
  const h = await prepareAcknowledgementScenario("clean");
  const alternate = await constructRenewalScheduleAttachmentReceiptV2(raw);
  admitInitialOutput(alternate, h.prepared, h.request);
  const eventArgs = await thirdEventArgs(h, alternate);
  const committed = await h.t.mutation(append, eventArgs);
  expect(committed.sequence).toBe(3);
  expect(committed.binding).toBe(eventArgs.event.binding);
  expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await h.physical();
  expect(Object.values(before).map((rows) => rows.length)).toEqual([
    1, 1, 3, 4,
  ]);
  expect(
    Object.prototype.hasOwnProperty.call(
      before.operations[0],
      "knownAcknowledgement",
    ),
  ).toBe(false);
  try {
    await expect(
      h.t.mutation(retain, { ...h.args, expectedSequence: 3 }),
    ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
  } finally {
    expect(await h.physical()).toEqual(before);
    expect(h.fetchCalls()).toBe(0);
  }
});
it("ACK07 parent abort rolls back tentative receipt retention", async () => {
  const h = await prepareAcknowledgementScenario("clean");
  let received = false;
  await expect(
    h.t.mutation(async (ctx) => {
      const retained = await ctx.runMutation(retain, h.args);
      assert(retained);
      expect(retained.status).toBe("retained");
      expect(retained.operationId).toBe(h.queryArgs.operationId);
      received = true;
      throw Error("ACK_PARENT_ABORT_AFTER_RETAINED");
    }),
  ).rejects.toThrow("ACK_PARENT_ABORT_AFTER_RETAINED");
  expect(received).toBe(true);
  expect(await h.physical()).toEqual(h.before);
  expect(h.fetchCalls()).toBe(0);
});
it("ACK08 corrupted retained receipt owner refuses duplicate without repair", async () => {
  const h = await acknowledgementScenario("clean");
  assert(h);
  await h.t.run((ctx) =>
    ctx.db.patch("renewalOperationPayloads", h.retained.receiptPayloadId, {
      owner: { kind: "operation", operationId: h.queryArgs.operationId },
    }),
  );
  const before = await h.physical();
  expect(
    before.payloads.find((row) => row._id === h.retained.receiptPayloadId)
      ?.owner,
  ).toEqual({
    kind: "operation",
    operationId: h.queryArgs.operationId,
  });
  try {
    await expect(h.t.mutation(retain, h.args)).rejects.toThrow(
      "RENEWAL_JOURNAL_CONFLICT",
    );
  } finally {
    expect(await h.physical()).toEqual(before);
    expect(h.fetchCalls()).toBe(0);
  }
});

it.each(["fresh-stale2", "known-future3"] as const)(
  "ACK09 %s refuses a sequence crossing the validated history head",
  async (mode) => {
    const h =
      mode === "fresh-stale2"
        ? await prepareAcknowledgementScenario("clean")
        : await acknowledgementScenario("clean");
    assert(h);
    if (mode === "fresh-stale2") {
      const eventArgs = await thirdEventArgs(h, h.receipt);
      const committed = await h.t.mutation(append, eventArgs);
      expect(committed.sequence).toBe(3);
      expect(committed.binding).toBe(eventArgs.event.binding);
      expect(committed.reservation).toEqual(h.acquired.reservation);
      expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const before = await h.physical();
    const head = mode === "fresh-stale2" ? 3 : 2;
    expect(Object.values(before).map((rows) => rows.length)).toEqual([
      1,
      1,
      head,
      4,
    ]);
    expect(before.attempts[0].lastSequence).toBe(head);
    expect(
      Object.prototype.hasOwnProperty.call(
        before.operations[0],
        "knownAcknowledgement",
      ),
    ).toBe(mode === "known-future3");
    const expectedSequence: 2 | 3 = mode === "fresh-stale2" ? 2 : 3;
    const args = { ...h.args, expectedSequence };
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    for (const rows of Object.values(before))
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    try {
      await expect(h.t.mutation(retain, args)).rejects.toThrow(
        "RENEWAL_JOURNAL_CONFLICT",
      );
    } finally {
      expect(await h.physical()).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
    }
  },
);
