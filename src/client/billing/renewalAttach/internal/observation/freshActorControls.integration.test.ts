import { expect, vi } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { prepareFreshObservation } from "../test-fixtures/freshObservation.js";
import {
  observerIdentity,
  authorizeObservation,
  readerControls,
} from "../test-fixtures/observationReader.js";
import { captureFreshRenewalObservation } from "./freshActor.js";
import {
  captureObservationInvocation,
  readObservationInvocation,
} from "./invocation.js";
import { captureFreshGetTransport } from "./freshTransport.js";
import Stripe from "stripe";
import * as replyCapture from "./capture.js";
import * as analyzer from "../../../renewalObservation/evidence-v1.js";
import { captureAuthorizedObservationHistoryReader } from "./reader.js";

const options = { identity: observerIdentity, hostQuery: authorizeObservation };
configureAdmissionCase(
  "reader guard refusal clears its original timer immediately",
  prepareFreshObservation,
  async (h, state) => {
    await h.inAnotherAction(async (ctx) => {
      const original = ctx.runQuery;
      const timers = vi.getTimerCount();
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      ctx.runQuery = async () => null;
      try {
        await expect(reader.read()).rejects.toThrow();
      } finally {
        ctx.runQuery = original;
      }
      expect(vi.getTimerCount()).toBe(timers);
    });
  },
  options,
);
configureAdmissionCase(
  "observer profile revocation during history acquisition refuses before selection",
  prepareFreshObservation,
  async (h, state) => {
    const selectors = admissionControls.selectors,
      calls = h.calls.length;
    readerControls.reply = (grant) => {
      admissionControls.observation.splice(0);
      return grant;
    };
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      await expect(actor.invoke()).rejects.toThrow();
    });
    expect(admissionControls.selectors).toBe(selectors);
    expect(h.calls).toHaveLength(calls);
  },
  options,
);
configureAdmissionCase(
  "copied invocation tokens, supplied history and copied profiles cannot select a client",
  prepareFreshObservation,
  async (h, state) => {
    const selectors = admissionControls.selectors;
    await h.inAnotherAction(async (ctx) => {
      const token = await captureObservationInvocation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const cell = readObservationInvocation(token);
      try {
        const captured = await cell.captureHistory();
        expect(() =>
          captureFreshGetTransport({ ...token }, state.profile),
        ).toThrow();
        expect(() =>
          captureFreshGetTransport(captured.history, state.profile),
        ).toThrow();
        expect(() =>
          captureFreshGetTransport(token, { ...state.profile }),
        ).toThrow();
      } finally {
        cell.close();
      }
      expect(() => readObservationInvocation(token)).toThrow();
    });
    expect(admissionControls.selectors).toBe(selectors);
  },
  options,
);
configureAdmissionCase(
  "qualifier refusal, duplicate profiles and copied history entries do not select or GET",
  prepareFreshObservation,
  async (h, state) => {
    const selectors = admissionControls.selectors,
      calls = h.calls.length;
    admissionControls.observation.push(state.profile);
    await expect(
      captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: h.ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      }),
    ).rejects.toThrow();
    admissionControls.observation.splice(
      0,
      2,
      Object.freeze({ ...state.profile, historyEntry: { ...state.entry } }),
    );
    await expect(
      captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: h.ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      }),
    ).rejects.toThrow();
    admissionControls.observation.splice(
      0,
      1,
      Object.freeze({ ...state.profile, coversObservation: () => false }),
    );
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      await expect(actor.invoke()).rejects.toThrow();
    });
    expect(admissionControls.selectors).toBe(selectors);
    expect(h.calls).toHaveLength(calls);
  },
  options,
);
for (const point of [2, 3, 4, 5, 6, 7, 8])
  configureAdmissionCase(
    "revocation at authorization point " +
      point +
      " prevents further GETs and release",
    (h) => prepareFreshObservation(h, { active: true }),
    async (h, state) => {
      const before = h.calls.length;
      readerControls.reply = (grant, count) => (count === point ? null : grant);
      await h.inAnotherAction(async (ctx) => {
        const actor = await captureFreshRenewalObservation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        await expect(actor.invoke()).rejects.toThrow();
      });
      expect(h.calls.slice(before)).toHaveLength(point - 2);
      expect(await h.journal.readProviderAcknowledgement()).not.toBeNull();
    },
    options,
  );
for (const terminal of ["canceled", "released", "completed"] as const)
  configureAdmissionCase(
    "multi-item " +
      terminal +
      " preserves terminal facts and incomplete-inventory evidence",
    prepareFreshObservation,
    async (h, state) => {
      const before = h.calls.length,
        schedule = state.reads.schedule;
      const original = state.reads.subscription.items.data[0];
      state.reads.subscription.items.data.push({
        ...structuredClone(original),
        id: "si_additional",
      });
      Object.assign(schedule, {
        status: terminal,
        current_phase: null,
        subscription: terminal === "canceled" ? "sub_original" : null,
        canceled_at:
          terminal === "canceled" ? Math.floor(Date.now() / 1000) : null,
        released_at:
          terminal === "released" ? Math.floor(Date.now() / 1000) : null,
        completed_at: terminal === "completed" ? 1773532800 : null,
        released_subscription: terminal === "canceled" ? null : "sub_original",
      });
      if (terminal !== "canceled") state.reads.subscription.schedule = null;
      await h.inAnotherAction(async (ctx) => {
        const actor = await captureFreshRenewalObservation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        const result = await actor.invoke();
        expect(result.status).toBe("unsupported_observation_profile");
        expect(result.couponInventory).toBe("incomplete");
        expect(result.reads?.coupons).toEqual([]);
        expect(result.evidence?.lifecycle.providerStatus).toBe(terminal);
        expect(result.evidence?.lifecycle.facts).not.toBeNull();
        expect(result.evidence?.lifecycle.predicate).toBe(
          terminal === "completed" ? "unknown" : "status_only",
        );
        expect(result.evidence?.currentMaterial.predicate).toBe("unknown");
      });
      expect(h.calls.slice(before)).toHaveLength(4);
    },
    options,
  );
configureAdmissionCase(
  "coupon inventory exceeding forty unique IDs stops after four base GETs without truncation",
  prepareFreshObservation,
  async (h, state) => {
    const before = h.calls.length,
      sub = state.reads.subscription,
      item = sub.items.data[0];
    const groups = [
      [sub, "sub"],
      [item, "item"],
    ] as const;
    for (const [owner, level] of groups) {
      const original = owner.discounts[0];
      owner.discounts = Array.from({ length: 20 }, (_, index) => {
        const discount = structuredClone(original);
        discount.id = "di_" + level + index;
        discount.source.coupon.id = "coupon-" + level + index;
        return discount;
      });
    }
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(result.status).toBe("unsupported_observation_profile");
      expect(result.couponInventory).toBe("incomplete");
      expect(result.reads?.subscription).toEqual(sub);
    });
    expect(h.calls.slice(before)).toHaveLength(4);
  },
  options,
);
let rejectRead = false;
for (const revoke of [false, true])
  configureAdmissionCase(
    "actual GET rejection retains C3 only after final authorization; revoked=" +
      revoke,
    async (h) => {
      rejectRead = false;
      return prepareFreshObservation(h);
    },
    async (h, state) => {
      const before = h.calls.length;
      rejectRead = true;
      readerControls.reply = (grant, count) =>
        revoke && count === 3 ? null : grant;
      await h.inAnotherAction(async (ctx) => {
        const actor = await captureFreshRenewalObservation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        if (revoke) await expect(actor.invoke()).rejects.toThrow();
        else {
          const result = await actor.invoke();
          expect(result.status).toBe("observation_provider_rejected");
          expect(result.failure?.category).toBe("provider_rejected");
          expect(result.failure?.ordinal).toBe(1);
          expect(result.history.attachmentReceipt).toEqual(
            JSON.parse(state.full.parent.acknowledgement!.receiptJSON),
          );
          expect(result.evidence).toBeNull();
        }
      });
      expect(readerControls.authorizations).toBe(3);
      expect(h.calls.slice(before)).toHaveLength(1);
    },
    {
      ...options,
      beforeFetch: async (_path, method) => {
        if (rejectRead && method === "GET") {
          rejectRead = false;
          throw Error("CONTROLLED_ASYNC_READ_REJECTION");
        }
      },
    },
  );
configureAdmissionCase(
  "a poisoned public then on the actual SDK promise is not invoked",
  prepareFreshObservation,
  async (h, state) => {
    let traps = 0;
    let restore = () => {};
    admissionControls.onSelect = (client) => {
      const sender: object = Reflect.get(client, "_requestSender");
      const raw = Reflect.get(sender, "_rawRequest");
      if (typeof raw !== "function") throw Error("TEST_SENDER_UNBOUND");
      Reflect.set(sender, "_rawRequest", function (...args: unknown[]) {
        const promise: object = Reflect.apply(raw, sender, args);
        Object.defineProperty(promise, "then", {
          configurable: true,
          get() {
            traps++;
            throw Error("POISON_PUBLIC_THEN");
          },
        });
        return promise;
      });
      restore = () => {
        Reflect.set(sender, "_rawRequest", raw);
      };
    };
    try {
      await h.inAnotherAction(async (ctx) => {
        const actor = await captureFreshRenewalObservation(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        expect((await actor.invoke()).status).toBe("fresh_observation_data");
      });
      expect(traps).toBe(0);
    } finally {
      restore();
      admissionControls.onSelect = null;
    }
  },
  options,
);
for (const drift of ["key", "prototype", "own-method"] as const) {
  let active = false,
    alter = () => {};
  configureAdmissionCase(
    "client/config drift during an actual GET refuses output: " + drift,
    async (h) => {
      active = false;
      return prepareFreshObservation(h);
    },
    async (h, state) => {
      const before = h.calls.length;
      const key = Object.getOwnPropertyDescriptor(h.sdk, "_apiKey")!;
      const method = Object.getOwnPropertyDescriptor(
        Stripe.prototype,
        "rawRequest",
      )!;
      let client: object | null = null;
      admissionControls.onSelect = (selected) => {
        client = selected;
      };
      alter = () => {
        if (drift === "key")
          Object.defineProperty(h.sdk, "_apiKey", {
            ...key,
            value: "sk_test_invalid_changed",
          });
        if (drift === "prototype")
          Object.defineProperty(Stripe.prototype, "rawRequest", {
            ...method,
            value() {
              throw Error("POISON_METHOD");
            },
          });
        if (drift === "own-method" && client)
          Object.defineProperty(client, "rawRequest", {
            configurable: true,
            value() {
              throw Error("POISON_OWN_METHOD");
            },
          });
      };
      active = true;
      try {
        await h.inAnotherAction(async (ctx) => {
          const actor = await captureFreshRenewalObservation(h.sdk, {
            actualActionCtx: ctx,
            operationId: state.operationId,
            parentOperationId: state.parentOperationId,
          });
          await expect(actor.invoke()).rejects.toThrow();
        });
        expect(h.calls.slice(before)).toHaveLength(1);
      } finally {
        active = false;
        Object.defineProperty(h.sdk, "_apiKey", key);
        Object.defineProperty(Stripe.prototype, "rawRequest", method);
        if (client) Reflect.deleteProperty(client, "rawRequest");
        admissionControls.onSelect = null;
      }
    },
    {
      ...options,
      beforeFetch: async (_path, method) => {
        if (active && method === "GET") alter();
      },
    },
  );
}
configureAdmissionCase(
  "decoder failure is not a provider rejection; analysis failure has a finite unadmitted result",
  prepareFreshObservation,
  async (h, state) => {
    const decoder = vi
      .spyOn(replyCapture, "captureObservationReply")
      .mockImplementationOnce(() => {
        throw Error("CONTROLLED_DECODER_REFUSAL");
      });
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      await expect(actor.invoke()).rejects.toThrow(
        "CONTROLLED_DECODER_REFUSAL",
      );
    });
    decoder.mockRestore();
    vi.spyOn(analyzer, "inspectRenewalEvidenceV1").mockRejectedValueOnce(
      Error("CONTROLLED_ANALYSIS_REFUSAL"),
    );
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(result.analysis).toBe("analysis_not_admitted");
      expect(result.evidence).toBeNull();
      expect(result.failure).toBeNull();
      expect(Object.keys(result)).not.toContain("invocation");
    });
  },
  options,
);
