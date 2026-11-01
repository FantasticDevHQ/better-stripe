import { afterEach, expect, it, vi } from "vitest";
import {
  witnessFixture,
  addWitnessInvoices,
} from "../../../tests/renewalObservation/witnessFixtures.js";
import { canonicalConfigure } from "../renewalOperations/configureJournal.fixtures.js";
import { canonicalWitnessJSON } from "../../shared/renewalWitness.js";
import { validateWitness } from "./eligibility.js";
import { retainWitness, readWitness } from "./protocol.js";
import { inspectRenewalEvidenceV1 } from "../../client/billing/renewalObservation/evidence-v1.js";

afterEach(() => vi.unstubAllGlobals());
const argsFor = (h: Awaited<ReturnType<typeof witnessFixture>>) => ({
  identity: h.identity,
  payloadJSON: canonicalConfigure(h.payload),
});

for (const retained of [false, true])
  it(
    "stored native target material remains independent of later live drift, C9=" +
      retained,
    async () => {
      const h = await witnessFixture(retained);
      const original = argsFor(h).payloadJSON;
      await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
      h.payload.reads.schedule.status = "canceled";
      h.payload.reads.schedule.canceled_at =
        h.payload.acquisition.observedAtMs / 1000;
      h.payload.reads.subscription.description = "LATER_LIVE_DRIFT";
      const stored = await h.t.run((ctx) => readWitness(ctx, h.identity));
      expect(stored?.payloadJSON).toBe(original);
      const snapshot = JSON.parse(stored!.payloadJSON);
      const result = await inspectRenewalEvidenceV1({
        version: 1,
        apiVersion: "2026-09-30.endive",
        configuration: h.configuration,
        configureReceipt: h.rawConfigureReceipt,
        reads: h.payload.reads,
        invoiceContext: null,
        historicalSnapshot: {
          reads: snapshot.reads,
          invoiceContext: snapshot.invoiceContext,
        },
      });
      expect(result.historicalMaterial.predicate).toBe(
        "snapshot_target_material_match",
      );
      expect(result.currentMaterial.predicate).not.toBe(
        "current_target_material_match",
      );
      expect(result.operationalAuthority).toBe(false);
    },
  );
for (const retained of [false, true])
  it(
    "retains exact full invoice context with optional C9=" + retained,
    async () => {
      const h = await witnessFixture(retained);
      addWitnessInvoices(h);
      const args = argsFor(h);
      const result = await h.t.run((ctx) => retainWitness(ctx, args));
      expect(result.status).toBe("retained");
      const read = await h.t.run((ctx) => readWitness(ctx, h.identity));
      expect(read?.payloadJSON).toBe(args.payloadJSON);
      const stored = JSON.parse(read!.payloadJSON);
      expect(
        stored.invoiceContext.current.linePages[0].data[0].pricing
          .unit_amount_decimal,
      ).toBe("2000.000000000000");
      expect(stored.invoiceContext.original.invoice.futureInvoice).toEqual({
        preserved: null,
      });
      expect(
        stored.invoiceContext.current.linePages[0].data[0].futureLine,
      ).toEqual([null, "retained"]);
    },
  );

it("a valid response2 without retained C9 does not fabricate receipt retention", async () => {
  const h = await witnessFixture();
  await h.retainConfigure(false);
  const result = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
  expect(result.status).toBe("retained");
  const read = await h.t.run((ctx) => readWitness(ctx, h.identity));
  expect(
    JSON.parse(read!.payloadJSON).source.configure.acknowledgement,
  ).toBeNull();
});

for (const bytes of [480000, 499900])
  it(
    "bounds the complete payload and descriptor before insertion near " +
      bytes +
      " bytes",
    async () => {
      const base = await witnessFixture(false, { sourcePadding: "" });
      const overhead = new TextEncoder().encode(
        canonicalConfigure(base.payload),
      ).length;
      const padding = "x".repeat(Math.floor((bytes - overhead) / 2));
      const h = await witnessFixture(false, { sourcePadding: padding });
      const args = argsFor(h);
      const actual = new TextEncoder().encode(args.payloadJSON).length;
      expect(actual).toBeGreaterThanOrEqual(bytes - 1);
      expect(actual).toBeLessThanOrEqual(bytes);
      expect(canonicalWitnessJSON(args.payloadJSON).json).toBe(
        args.payloadJSON,
      );
      expect(
        await h.t.run(
          async (ctx) =>
            (await validateWitness(ctx, args.payloadJSON)).fields
              .observedItemId,
        ),
      ).toBe("si_successor");
      if (bytes === 499900) {
        await expect(
          h.t.run((ctx) => retainWitness(ctx, args)),
        ).rejects.toThrow();
        expect(
          await h.t.run((ctx) =>
            ctx.db.query("renewalObservationWitnesses").take(1),
          ),
        ).toEqual([]);
      } else {
        expect((await h.t.run((ctx) => retainWitness(ctx, args))).status).toBe(
          "retained",
        );
        const read = await h.t.run((ctx) => readWitness(ctx, h.identity));
        expect(read?.payloadJSON).toBe(args.payloadJSON);
        expect(
          JSON.parse(read!.payloadJSON).source.parent.record.originalBundle
            .witnessPadding,
        ).toBe(padding);
      }
    },
  );

it("an existing witness identity cannot adopt a different otherwise valid configure operation", async () => {
  const h = await witnessFixture();
  const originalIdentity = { ...h.identity },
    originalJSON = argsFor(h).payloadJSON;
  const first = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
  const record = structuredClone(h.record);
  record.logicalOperationId += ":fork";
  const createArgs = {
    ...h.createArgs,
    logicalOperationId: record.logicalOperationId,
    recordJSON: canonicalConfigure(record),
  };
  const next = await h.t.mutation(h.create, createArgs);
  await h.t.mutation(h.reserve, {
    operationId: next.operationId,
    expectedRevision: 0,
    stage: "configure",
    expectedRequestBinding: h.request.requestIdentity.binding,
    recordJSON: createArgs.recordJSON,
  });
  const loaded = await h.t.query(h.load, { operationId: next.operationId });
  h.identity.operationId = next.operationId;
  h.payload.source.configure.record = JSON.parse(loaded.recordJSON);
  h.payload.source.configure.reservation = loaded.activeAttempt;
  expect(
    await h.t.run(
      async (ctx) =>
        (await validateWitness(ctx, argsFor(h).payloadJSON)).fields
          .observedItemId,
    ),
  ).toBe("si_successor");
  expect(await h.t.run((ctx) => retainWitness(ctx, argsFor(h)))).toEqual({
    status: "conflict",
    reason: "identity_changed",
  });
  expect(await h.t.run((ctx) => readWitness(ctx, originalIdentity))).toEqual({
    descriptor: Reflect.get(first, "descriptor"),
    payloadJSON: originalJSON,
  });
});

it("a recomputed payload hash cannot hide material corruption", async () => {
  const h = await witnessFixture();
  const result = await h.t.run((ctx) => retainWitness(ctx, argsFor(h)));
  if (result.status !== "retained") throw Error("EXPECTED_RETENTION");
  h.payload.reads.subscription.description = "ALTERED_AFTER_CAPTURE";
  const raw = canonicalConfigure(h.payload);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("renewal-witness:v1\u0000" + raw),
  );
  const binding =
    "renewal-witness:v1:sha256:" +
    [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  await h.t.run((ctx) =>
    ctx.db.patch(result.descriptor.witnessRowId, {
      payloadJSON: raw,
      payloadBinding: binding,
    }),
  );
  await expect(
    h.t.run((ctx) => readWitness(ctx, h.identity)),
  ).rejects.toThrow();
});
