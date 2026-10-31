import {
  configureAdmissionFixture,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { expect, it, vi } from "vitest";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { createAdmittedConfigureEventCompiler } from "../c10/configureEvents.js";
import { journalWorkForConfigureLineage } from "./configureJournalWork.js";
import { constructRenewalConfigurationReceiptV2 } from "../../../renewalV2/index.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";

it.each(["absent", "null", "object"])(
  "appends a distinct configure C10 sequence with %s defaults through actual component commits",
  async (defaults) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const child = await h.child();
      const admitted = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const events = createAdmittedConfigureEventCompiler(admitted);
      const request = child.record.configureRecord.request;
      const transport = {
        status: 200,
        requestId: "req_synthetic_configure_channel",
      };
      const body: Record<string, unknown> = structuredClone(
        h.baseline.schedule,
      );
      if (defaults === "absent") delete body.default_settings;
      if (defaults === "null") body.default_settings = null;
      body.future_response = { retained: [null, "complete", 1.25] };
      const receipt = await constructRenewalConfigurationReceiptV2({
        configuration: child.record.configureRecord.configuration,
        actualDispatch: child.record.dispatch,
        providerSnapshot: body,
        transport,
      });
      const values = [
        { event: "dispatch", stage: "configure", request },
        {
          event: "response",
          stage: "configure",
          request,
          body,
          transport,
        },
        { event: "receipt", stage: "configure", request, receipt },
      ];
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      const reservation = child.fresh.result.reservation;
      const calls = h.calls.length,
        selectors = admissionControls.selectors;
      for (const [index, method] of [
        events.dispatch,
        events.response,
        events.receipt,
      ].entries()) {
        if (index === 2)
          await child.journal.retainProviderAcknowledgement({
            attemptId: reservation.attemptId,
            expectedSequence: 2,
            receiptJSON: JSON.stringify(renewalSnapshot(receipt)),
          });
        const result = await method(values[index]);
        expect(result).toEqual({
          kind: "C10_EVENT_DATA_APPENDED",
          stageChannel: "configure",
          actualFulfillmentEstablished: false,
          authenticationEstablished: false,
        });
        const stored = await child.journal.readStageEvent({
          attemptId: reservation.attemptId,
          sequence: index === 0 ? 1 : index === 1 ? 2 : 3,
        });
        expect(stored?.dataJSON).toBe(
          JSON.stringify(renewalSnapshot(values[index])),
        );
      }
      const history = await child.journal.readAttempt({
        attemptId: reservation.attemptId,
      });
      expect(history?.events.map((event) => event.stage)).toEqual([
        "configure",
        "configure",
        "configure",
      ]);
      const known = await child.journal.readProviderAcknowledgement();
      expect(known?.receiptJSON).toBe(JSON.stringify(renewalSnapshot(receipt)));
      if (h.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_PARENT");
      expect(admitted.owner).toBe(h.core.owner);
      const parent = await h.journal.readAttempt({
        attemptId: h.fresh.result.reservation.attemptId,
      });
      expect(parent?.events.map((event) => event.stage)).toEqual([
        "attach",
        "attach",
        "attach",
      ]);
      expect(h.calls).toHaveLength(calls);
      expect(admissionControls.selectors).toBe(selectors);
      expect(admissionControls.legacy).toBe(0);
      expect(admitted.operationalAuthority).toBe(false);
    });
  },
);

it("a pending child append does not become another child's pending work", async () => {
  let armed = false,
    release!: () => void,
    entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const one = await h.child(),
        two = await h.child();
      const a = await h.core.admitConfigure(one.fresh.call, one.journal),
        b = await h.core.admitConfigure(two.fresh.call, two.journal);
      const first = createAdmittedConfigureEventCompiler(a),
        second = createAdmittedConfigureEventCompiler(b);
      const av = await h.eventsFor(one),
        bv = await h.eventsFor(two);
      const aw = journalWorkForConfigureLineage(a),
        bw = journalWorkForConfigureLineage(b);
      armed = true;
      const pending = first.dispatch(av.dispatch);
      try {
        await reached;
        expect(aw.idle()).toBe(false);
        expect(bw.idle()).toBe(true);
        await second.dispatch(bv.dispatch);
        expect(bw.idle()).toBe(true);
        expect(aw.idle()).toBe(false);
      } finally {
        release();
      }
      await pending;
      expect(aw.idle()).toBe(true);
      expect(admissionControls.legacy).toBe(0);
    },
    {
      afterAppend: async () => {
        if (armed) {
          armed = false;
          entered();
          await barrier;
        }
      },
    },
  );
});
it("concurrent child channels retain independent source requests and sequence heads", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const one = await h.child(),
      two = await h.child();
    const a = await h.core.admitConfigure(one.fresh.call, one.journal),
      b = await h.core.admitConfigure(two.fresh.call, two.journal);
    const first = createAdmittedConfigureEventCompiler(a),
      second = createAdmittedConfigureEventCompiler(b);
    const av = await h.eventsFor(one),
      bv = await h.eventsFor(two);
    await Promise.all([
      first.dispatch(av.dispatch),
      second.dispatch(bv.dispatch),
    ]);
    await Promise.all([
      first.response(av.response),
      second.response(bv.response),
    ]);
    await Promise.all([
      first.receipt(av.receiptEvent),
      second.receipt(bv.receiptEvent),
    ]);
    if (
      one.fresh.result.disposition !== "acquired" ||
      two.fresh.result.disposition !== "acquired"
    )
      throw Error("INVALID_FIXTURE_CAS");
    const ah = await one.journal.readAttempt({
        attemptId: one.fresh.result.reservation.attemptId,
      }),
      bh = await two.journal.readAttempt({
        attemptId: two.fresh.result.reservation.attemptId,
      });
    expect(ah?.events).toHaveLength(3);
    expect(bh?.events).toHaveLength(3);
    expect(ah?.events[0].eventId).not.toBe(bh?.events[0].eventId);
    expect(av.receipt.binding).not.toBe(bv.receipt.binding);
    expect(a.owner === b.owner).toBe(true);
    expect(() => h.core.owner.check()).not.toThrow();
  });
});
it("closing one SDK root cannot close another root's configure channel", async () => {
  let joined = 0,
    release!: () => void,
    retired!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    retired = resolve;
  });
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const compiler = createAdmittedConfigureEventCompiler(token),
        values = await h.eventsFor(child);
      await compiler.dispatch(values.dispatch);
      if (++joined === 2) release();
      await ready;
      if (h.index === 0) {
        h.core.owner.retire();
        retired();
        await expect(compiler.response(values.response)).rejects.toThrow(
          "C10_SOURCE_STOP",
        );
      } else {
        await closed;
        await compiler.response(values.response);
        await compiler.receipt(values.receiptEvent);
      }
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      expect(
        (
          await child.journal.readAttempt({
            attemptId: child.fresh.result.reservation.attemptId,
          })
        )?.events,
      ).toHaveLength(h.index === 0 ? 1 : 3);
    },
    {
      count: 2,
      keys: [
        "sk_test_invalid_channel_root_a",
        "sk_test_invalid_channel_root_b",
      ],
    },
  );
});

it("rechecks the child binding after an actual constructor hash await before appending", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    await h.inAnotherAction(async (ctx) => {
      const child = await h.child({ ctx });
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const compiler = createAdmittedConfigureEventCompiler(token),
        values = await h.eventsFor(child);
      let entered!: () => void,
        release!: () => void,
        first = true;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = globalThis.crypto.subtle.digest.bind(
        globalThis.crypto.subtle,
      );
      const digest = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockImplementation(async (...args) => {
          const result = await original(...args);
          if (first) {
            first = false;
            entered();
            await barrier;
          }
          return result;
        });
      const pending = compiler.dispatch(values.dispatch);
      const refused = expect(pending).rejects.toThrow("C10_SOURCE_STOP");
      const query = ctx.runQuery;
      try {
        await reached;
        ctx.runQuery = async () => {
          throw Error("CHANGED_DURING_HASH");
        };
        expect(() => h.core.owner.check()).not.toThrow();
      } finally {
        release();
      }
      await refused;
      ctx.runQuery = query;
      digest.mockRestore();
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      const history = await ctx.runQuery(
        components.betterStripe.renewalOperations.queries.readAttempt,
        {
          operationId: child.created.operationId,
          attemptId: child.fresh.result.reservation.attemptId,
        },
      );
      expect(history?.events).toHaveLength(0);
      expect(() => createAdmittedConfigureEventCompiler(token)).toThrow(
        "CONFIGURE_CHANNEL_CONSUMED",
      );
    });
  });
});
