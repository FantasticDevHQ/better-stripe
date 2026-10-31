import { afterEach, expect, it, vi } from "vitest";
import { witnessFixture } from "../../../tests/renewalObservation/witnessFixtures.js";
import { canonicalConfigure } from "../renewalOperations/configureJournal.fixtures.js";
import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
import { retainWitness, readWitness } from "./protocol.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const argsFor = (h: Awaited<ReturnType<typeof witnessFixture>>) => ({
  identity: h.identity,
  payloadJSON: canonicalConfigure(h.payload),
});
async function count(h: Awaited<ReturnType<typeof witnessFixture>>) {
  return h.t.run(
    async (ctx) =>
      (await ctx.db.query("renewalObservationWitnesses").take(3)).length,
  );
}

it("rejects an opaque configure event even when its stored hash and ownership are valid", async () => {
  const h = await witnessFixture();
  await h.t.mutation(h.bind, {
    operationId: h.created.operationId,
    attemptId: h.reserved.reservation.attemptId,
    policyJSON: canonicalConfigure(h.record.timingPolicy),
    basisJSON: canonicalConfigure(h.basis),
  });
  const event = await canonicalJournalEvent(
    1,
    canonicalConfigure({ opaque: "unbound configure event" }),
  );
  await h.t.mutation(h.append, {
    reservation: h.reserved.reservation,
    expectedSequence: 0,
    event: { sequence: 1, binding: event.binding, dataJSON: event.json },
  });
  await expect(
    h.t.run((ctx) => retainWitness(ctx, argsFor(h))),
  ).rejects.toThrow();
  expect(await count(h)).toBe(0);
});

for (const retained of [false, true])
  it("preserves complete witness with captured C9=" + retained, async () => {
    const h = await witnessFixture(retained);
    const result = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
    expect(result.status).toBe("retained");
    if (result.status !== "retained") throw Error("EXPECTED_RETENTION");
    expect(result.descriptor.observedItemId).toBe("si_successor");
    expect(result.descriptor.providerQualificationRequired).toBe(true);
    const read = await h.t.run((ctx) => readWitness(ctx, h.identity));
    expect(read?.descriptor).toEqual(result.descriptor);
    expect(JSON.parse(read!.payloadJSON)).toEqual(h.payload);
    expect(read?.descriptor.authenticationEstablished).toBe(false);
  });

it("captured-null C9 remains null after a later valid retained C9", async () => {
  const h = await witnessFixture();
  const original = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
  await h.retainConfigure();
  const later = await h.t.run((ctx) => readWitness(ctx, h.identity));
  expect(original.status).toBe("retained");
  if (original.status !== "retained") throw Error("EXPECTED_RETENTION");
  expect(later?.descriptor).toEqual(original.descriptor);
  expect(
    JSON.parse(later!.payloadJSON).source.configure.acknowledgement,
  ).toBeNull();
});

it("concurrent duplicate transactions retain one complete immutable row", async () => {
  const h = await witnessFixture();
  const results = await Promise.all([
    h.t.run((ctx) => retainWitness(ctx, argsFor(h))),
    h.t.run((ctx) => retainWitness(ctx, argsFor(h))),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await count(h)).toBe(1);
});

it("changed valid payload conflicts and cannot overwrite the original", async () => {
  const h = await witnessFixture();
  const args = argsFor(h);
  const first = await h.t.run((ctx) => retainWitness(ctx, args));
  h.payload.capturedSubject = "https://host.test|different-capture";
  expect(await h.t.run((ctx) => retainWitness(ctx, argsFor(h)))).toEqual({
    status: "conflict",
    reason: "identity_changed",
  });
  expect(await h.t.run((ctx) => readWitness(ctx, h.identity))).toEqual({
    descriptor: Reflect.get(first, "descriptor"),
    payloadJSON: args.payloadJSON,
  });
  expect(await count(h)).toBe(1);
});

for (const field of ["componentScope", "witnessId", "operations"] as const)
  it(
    "wrong read identity refuses without exposing payload: " + field,
    async () => {
      const h = await witnessFixture();
      await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
      const identity = { ...h.identity };
      if (field === "operations") {
        identity.parentOperationId = h.identity.operationId;
        identity.operationId = h.identity.parentOperationId;
      } else identity[field] = "foreign";
      expect(await h.t.run((ctx) => readWitness(ctx, identity))).toBeNull();
    },
  );

for (const control of [
  "C1",
  "C7",
  "C3",
  "basis",
  "reservation",
  "unretained-C9",
  "material",
  "target-item",
  "invoice-context",
] as const)
  it("refuses altered source/material before storage: " + control, async () => {
    const h = await witnessFixture();
    if (control === "C1")
      Reflect.set(h.payload.source.parent.record, "profile", "ALTERED");
    if (control === "C7")
      Reflect.set(
        h.payload.source.configure.record,
        "logicalOperationId",
        "ALTERED",
      );
    if (control === "C3")
      Reflect.set(
        h.payload.source.parent.acknowledgement!.receipt,
        "binding",
        "ALTERED",
      );
    if (control === "basis")
      Reflect.set(h.payload.source.parent.initialBasis, "basisJSON", "{}");
    if (control === "reservation")
      Reflect.set(
        h.payload.source.configure.reservation,
        "requestBinding",
        "ALTERED",
      );
    if (control === "unretained-C9")
      h.payload.source.configure.acknowledgement = structuredClone(
        h.payload.source.parent.acknowledgement,
      );
    if (control === "material")
      h.payload.reads.subscription.description = "ALTERED";
    if (control === "target-item")
      h.payload.reads.subscription.items.data.push(
        structuredClone(h.payload.reads.subscription.items.data[0]),
      );
    if (control === "invoice-context")
      Reflect.set(h.payload, "invoiceContext", {
        original: null,
        current: null,
      });
    await expect(
      h.t.run((ctx) => retainWitness(ctx, argsFor(h))),
    ).rejects.toThrow();
    expect(await count(h)).toBe(0);
  });

for (const control of [
  "binding",
  "payload",
  "duplicate",
  "parent-owner",
  "configure-owner",
  "missing-C3",
] as const)
  it(
    "rechecks stored rows and source integrity on reads: " + control,
    async () => {
      const h = await witnessFixture();
      const result = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
      if (result.status !== "retained") throw Error("EXPECTED_RETENTION");
      await h.t.run(async (ctx) => {
        const row = await ctx.db.get(
          "renewalObservationWitnesses",
          result.descriptor.witnessRowId,
        );
        if (!row) throw Error("MISSING_ROW");
        if (control === "binding")
          await ctx.db.patch(row._id, { payloadBinding: "ALTERED" });
        if (control === "payload") {
          const value = JSON.parse(row.payloadJSON);
          value.capturedSubject = "ALTERED";
          await ctx.db.patch(row._id, {
            payloadJSON: canonicalConfigure(value),
          });
        }
        if (control === "duplicate")
          await ctx.db.insert("renewalObservationWitnesses", {
            identity: row.identity,
            payloadJSON: row.payloadJSON,
            payloadBinding: row.payloadBinding,
          });
        if (control === "parent-owner" || control === "configure-owner") {
          const operationId =
            control === "parent-owner"
              ? h.identity.parentOperationId
              : h.identity.operationId;
          const operation = await ctx.db.get("renewalOperations", operationId);
          if (!operation) throw Error("MISSING_OPERATION");
          await ctx.db.patch(operation.payloadId, {
            owner: {
              kind: "operation",
              operationId:
                control === "parent-owner"
                  ? h.identity.operationId
                  : h.identity.parentOperationId,
            },
          });
        }
        if (control === "missing-C3") {
          const operation = await ctx.db.get(
            "renewalOperations",
            h.identity.parentOperationId,
          );
          if (!operation?.knownAcknowledgement) throw Error("MISSING_ACK");
          await ctx.db.delete(operation.knownAcknowledgement.receiptPayloadId);
        }
      });
      await expect(
        h.t.run((ctx) => readWitness(ctx, h.identity)),
      ).rejects.toThrow();
    },
  );

it("a lost caller response leaves one row but does not establish public ACK delivery", async () => {
  const h = await witnessFixture();
  let committed: Awaited<ReturnType<typeof retainWitness>> | null = null;
  await expect(
    (async () => {
      committed = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
      throw Error("CONTROLLED_LOST_REPLY");
    })(),
  ).rejects.toThrow("CONTROLLED_LOST_REPLY");
  expect(await count(h)).toBe(1);
  const duplicate = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
  expect(duplicate).toEqual(committed);
  if (duplicate.status !== "retained") throw Error("EXPECTED_RETENTION");
  expect(duplicate.descriptor.publicDeliveryEstablished).toBe(false);
});
