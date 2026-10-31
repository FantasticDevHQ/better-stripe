import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import {
  INITIAL_NS,
  INITIAL_WALL,
} from "../test-fixtures/producerInitialDeclarations.js";
import {
  captureInitialInvocationCore,
  type InitialInvocationCore,
} from "./invocationProducer.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
import { receiptInput } from "../acquisition/test-fixtures/fixture.mjs";
import { createInitialAttachEventCompiler } from "../c10/attachEvents.js";

async function rebuiltRequest(recordJSON: string) {
  const source = JSON.parse(recordJSON).attachRequest;
  const prepared = await prepareRenewalPriceReplacementV2(source.preparation);
  return prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: source.apiVersion,
    attachKey: source.attachKey,
    firstDispatchedAt: source.firstDispatchedAt,
  });
}

const legacy = vi.hoisted(() => ({ touched: 0 }));
vi.mock("../originalOwner.js", () => ({
  OWNER: Object.freeze({
    get basis() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    check() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    sample() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    subscribe() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    retire() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
  }),
}));
beforeEach(() => {
  legacy.touched = 0;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(INITIAL_WALL);
  vi.spyOn(process.hrtime, "bigint").mockReturnValue(INITIAL_NS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("compiles initial dispatch through its actual Owner and commits before C10 ACK with legacy Owner poisoned", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    assert(fresh.result.disposition === "acquired");
    const request = await rebuiltRequest(fresh.result.reservation.recordJSON);
    const core = await captureInitialInvocationCore(fresh.call, journal);
    try {
      expect(typeof core.attachEvents).toBe("function");
      const compiler = core.attachEvents();
      const result = await compiler.dispatch({
        event: "dispatch",
        stage: "attach",
        request,
      });
      expect(result.kind).toBe("C10_EVENT_DATA_APPENDED");
      const committed = await journal.readStageEvent({
        attemptId: fresh.result.reservation.attemptId,
        sequence: 1,
      });
      expect(committed).not.toBeNull();
      expect(legacy.touched).toBe(0);
      expect(() => core.attachEvents()).toThrow();
    } finally {
      core.owner.retire();
    }
  });
});

it("two pending registered-Action channels keep retirement and ACK independent", async () => {
  const cores: InitialInvocationCore[] = [];
  let ready = () => {};
  let appended = () => {};
  let retired = () => {};
  let release = () => {};
  let appends = 0;
  const bothReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const bothAppended = new Promise<void>((resolve) => {
    appended = resolve;
  });
  const firstRetired = new Promise<void>((resolve) => {
    retired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await initialOperations(
    async ({ fresh, journal, index }) => {
      assert(fresh.result.disposition === "acquired");
      const request = await rebuiltRequest(fresh.result.reservation.recordJSON);
      const core = await captureInitialInvocationCore(fresh.call, journal);
      cores[index] = core;
      try {
        const compiler = core.attachEvents();
        if (cores.filter(Boolean).length === 2) ready();
        await bothReady;
        const pending = compiler.dispatch({
          event: "dispatch",
          stage: "attach",
          request,
        });
        const observed = pending.then(
          () => true,
          () => false,
        );
        await bothAppended;
        expect(cores[0].owner === cores[1].owner).toBe(false);
        if (index === 0) {
          core.owner.retire();
          expect(await observed).toBe(false);
          retired();
        } else {
          await firstRetired;
          release();
          expect(await observed).toBe(true);
          expect(core.owner.check().retired).toBe(false);
        }
        expect(
          await journal.readStageEvent({
            attemptId: fresh.result.reservation.attemptId,
            sequence: 1,
          }),
        ).not.toBeNull();
        expect(await journal.readProviderAcknowledgement()).toBeNull();
        expect(legacy.touched).toBe(0);
      } finally {
        release();
        core.owner.retire();
      }
    },
    2,
    {
      afterAppend: async () => {
        if (++appends === 2) appended();
        await gate;
      },
    },
  );
});

it("a retired Owner refuses channel capture without appending or touching legacy state", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    assert(fresh.result.disposition === "acquired");
    const core = await captureInitialInvocationCore(fresh.call, journal);
    expect(typeof core.attachEvents).toBe("function");
    core.owner.retire();
    expect(() => core.attachEvents()).toThrow("INITIAL_OWNER_STOP");
    expect(
      await journal.readStageEvent({
        attemptId: fresh.result.reservation.attemptId,
        sequence: 1,
      }),
    ).toBeNull();
    expect(legacy.touched).toBe(0);
  });
});

it("legacy EMPTY initial capture refuses before the poisoned Owner", async () => {
  const { captureOwnedInitialAttachV2 } =
    await import("../operations/initialAttach.js");
  const actor = captureOwnedInitialAttachV2();
  expect(await actor.invoke()).toMatchObject({
    status: "not_dispatched",
    reason: "no_qualified_native_class",
  });
  expect(legacy.touched).toBe(0);
});

it("rejects a replacement sink before reading it and spends channel capture", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    let touched = 0;
    const replacement = {
      get send() {
        touched++;
        throw Error("FOREIGN_SINK");
      },
    };
    try {
      expect(() =>
        Reflect.apply(core.attachEvents, undefined, [replacement]),
      ).toThrow("INITIAL_CHANNEL_UNBOUND");
      expect(() => core.attachEvents()).toThrow("INITIAL_CHANNEL_CONSUMED");
      expect(touched).toBe(0);
      expect(legacy.touched).toBe(0);
    } finally {
      core.owner.retire();
    }
  });
});

it("refuses a copied lineage token before clock or legacy access", () => {
  const now = vi.spyOn(Date, "now");
  expect(() => createInitialAttachEventCompiler(Object.freeze({}))).toThrow(
    "INITIAL_LINEAGE_UNBOUND",
  );
  expect(now).not.toHaveBeenCalled();
  expect(legacy.touched).toBe(0);
});

it("compiles the complete initial three-event history through actual component mutations", async () => {
  const declared = receiptInput();
  const receipt = await constructRenewalScheduleAttachmentReceiptV2({
    attachRequest: declared.attachRequest,
    actualDispatch: {
      ...declared.actualDispatch,
      scope: "platform",
      method: "POST",
      path: "/v1/subscription_schedules",
    },
    providerSnapshot: declared.providerSnapshot,
  });
  await initialOperations(async ({ fresh, journal }) => {
    assert(fresh.result.disposition === "acquired");
    const reservation = fresh.result.reservation;
    const request = await rebuiltRequest(reservation.recordJSON);
    const core = await captureInitialInvocationCore(fresh.call, journal);
    try {
      const compiler = core.attachEvents();
      await compiler.dispatch({ event: "dispatch", stage: "attach", request });
      await compiler.response({
        event: "response",
        stage: "attach",
        request,
        body: declared.providerSnapshot,
        status: 200,
      });
      await compiler.receipt({
        event: "receipt",
        stage: "attach",
        request,
        receipt,
      });
      const events = [];
      for (const sequence of [1, 2, 3] as const) {
        const saved = await journal.readStageEvent({
          attemptId: reservation.attemptId,
          sequence,
        });
        assert(saved);
        events.push(saved);
      }
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
      expect(await journal.readProviderAcknowledgement()).toBeNull();
      expect(legacy.touched).toBe(0);
      expect(core.operationalAuthority).toBe(false);
    } finally {
      core.owner.retire();
    }
  });
});

it.each([false, true])(
  "a committed append delayed before its reply cannot ACK early, retire=%s",
  async (retire) => {
    let entered = () => {};
    let release = () => {};
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await initialOperations(
      async ({ fresh, journal }) => {
        assert(fresh.result.disposition === "acquired");
        const reservation = fresh.result.reservation;
        const request = await rebuiltRequest(reservation.recordJSON);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        try {
          const compiler = core.attachEvents();
          let settled = false;
          const pending = compiler.dispatch({
            event: "dispatch",
            stage: "attach",
            request,
          });
          const observed = pending.then(
            (value) => {
              settled = true;
              return { ok: true, value };
            },
            (error: unknown) => {
              settled = true;
              return { ok: false, error };
            },
          );
          await reached;
          const committed = await journal.readStageEvent({
            attemptId: reservation.attemptId,
            sequence: 1,
          });
          expect(committed).not.toBeNull();
          expect(settled).toBe(false);
          if (retire) {
            core.owner.retire();
            expect((await observed).ok).toBe(false);
          }
          release();
          const result = await observed;
          expect(result.ok).toBe(!retire);
          expect(
            await journal.readStageEvent({
              attemptId: reservation.attemptId,
              sequence: 1,
            }),
          ).toEqual(committed);
          expect(legacy.touched).toBe(0);
        } finally {
          release();
          core.owner.retire();
        }
      },
      1,
      {
        afterAppend: async () => {
          entered();
          await gate;
        },
      },
    );
  },
);
