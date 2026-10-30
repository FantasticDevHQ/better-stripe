import assert from "node:assert/strict";
import { vi } from "vitest";
import type { FailureForwarder } from "../operations/ownedAwait.js";
import type { createInitialOwnedTransportWithAttemptCapability } from "../operations/fixedTransport.js";
import { data } from "./attachScenarioBarriers.js";
type Pair = ReturnType<typeof createInitialOwnedTransportWithAttemptCapability>;
export function observationState() {
  return {
    recovering: false,
    phase: "",
    replay: false,
    digestHeld: false,
    observerErrors: [] as unknown[],
    pending: [] as Promise<unknown>[],
    c3Entries: 0,
    aC3Entries: 0,
    aC3AtPrefix: 0,
    aReceipt: null as unknown,
    c3AtPrefix: 0,
    c1Entries: 0,
    records: [] as Record<string, unknown>[],
    aRecords: [] as Record<string, unknown>[],
    callbacks: [] as ((value: unknown) => void)[],
    aCallbacks: [] as ((value: unknown) => void)[],
    control: null as unknown,
    pairA: null as Pair | null,
    pairB: null as Pair | null,
    receipt: null as unknown,
    result: null as unknown,
    aToken: null as unknown,
    aReply: null as unknown,
    outputEntries: 0,
    compilerReceipt: false,
  };
}
export type Observations = ReturnType<typeof observationState>;
export async function installObservers(
  s: Observations,
  name: string,
  retire: () => void,
) {
  vi.doMock("../operations/ownedAwait.js", async () => {
    const actual = await vi.importActual<
      typeof import("../operations/ownedAwait.js")
    >("../operations/ownedAwait.js");
    return {
      ...actual,
      owned<T>(
        work: () => T | PromiseLike<T>,
        control: FailureForwarder | null = null,
      ) {
        if (s.recovering && control) s.control = control;
        const p = actual.owned(work, control);
        s.pending.push(
          p.then(
            () => {},
            (error) => {
              if (!s.recovering && control) s.aToken = error;
            },
          ),
        );
        return p;
      },
    };
  });
  vi.doMock("../../../renewalV2/index.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../../renewalV2/index.js")
    >("../../../renewalV2/index.js");
    return {
      ...actual,
      prepareRenewalPriceReplacementV2(
        ...args: Parameters<typeof actual.prepareRenewalPriceReplacementV2>
      ) {
        if (s.recovering && ++s.c1Entries >= 3) s.replay = true;
        return actual.prepareRenewalPriceReplacementV2(...args);
      },
      prepareRenewalScheduleAttachmentV2(
        ...args: Parameters<typeof actual.prepareRenewalScheduleAttachmentV2>
      ) {
        const prior = s.phase;
        s.phase = "C2";
        const p = actual.prepareRenewalScheduleAttachmentV2(...args);
        s.pending.push(
          p.then(
            () => {
              s.phase = prior;
            },
            () => {
              s.phase = prior;
            },
          ),
        );
        return p;
      },
      constructRenewalScheduleAttachmentReceiptV2(
        ...args: Parameters<
          typeof actual.constructRenewalScheduleAttachmentReceiptV2
        >
      ) {
        const explicit = !s.compilerReceipt;
        if (explicit) {
          if (s.recovering) {
            s.c3Entries++;
            s.c3AtPrefix = s.records.length;
          } else {
            s.aC3Entries++;
            s.aC3AtPrefix = s.aRecords.length;
          }
        }
        const prior = s.phase;
        if (explicit) s.phase = "C3";
        const p = actual.constructRenewalScheduleAttachmentReceiptV2(...args);
        s.pending.push(
          p.then(
            (value) => {
              if (explicit) {
                if (s.recovering) s.receipt = value;
                else s.aReceipt = value;
              }
              s.phase = prior;
            },
            () => {
              s.phase = prior;
            },
          ),
        );
        return p;
      },
    };
  });
  vi.doMock("../c10/attachEvents.js", async () => {
    const actual = await vi.importActual<
      typeof import("../c10/attachEvents.js")
    >("../c10/attachEvents.js");
    return {
      ...actual,
      createAttachEventCompiler(
        ...args: Parameters<typeof actual.createAttachEventCompiler>
      ) {
        const compiler = actual.createAttachEventCompiler(...args);
        return Object.freeze({
          ...compiler,
          receipt(value: unknown) {
            s.compilerReceipt = true;
            const p = compiler.receipt(value);
            s.pending.push(
              p.then(
                () => {
                  s.compilerReceipt = false;
                },
                () => {
                  s.compilerReceipt = false;
                },
              ),
            );
            return p;
          },
        });
      },
    };
  });
  vi.doMock("../operations/fixedTransport.js", async () => {
    const actual = await vi.importActual<
      typeof import("../operations/fixedTransport.js")
    >("../operations/fixedTransport.js");
    return {
      ...actual,
      createInitialOwnedTransportWithAttemptCapability() {
        const pair = actual.createInitialOwnedTransportWithAttemptCapability();
        s.pairA = pair;
        return pair;
      },
      createRecoveryOwnedTransportWithAttemptCapability() {
        const pair = actual.createRecoveryOwnedTransportWithAttemptCapability();
        s.pairB = pair;
        return pair;
      },
    };
  });
  vi.doMock("../recovery/output.js", async () => {
    const actual = await vi.importActual<
      typeof import("../recovery/output.js")
    >("../recovery/output.js");
    return {
      ...actual,
      admitRecoveryOutput(
        ...args: Parameters<typeof actual.admitRecoveryOutput>
      ) {
        s.outputEntries++;
        const result = actual.admitRecoveryOutput(...args);
        s.result = result;
        if (name === "G07-result") retire();
        return result;
      },
    };
  });
}
export function controlView(value: unknown) {
  const record = data(value);
  const call = (name: string, args: unknown[]) => {
    const f = record[name];
    assert.equal(typeof f, "function");
    return Reflect.apply(f as (...xs: unknown[]) => unknown, value, args);
  };
  return {
    forward: (value: unknown) => call("forward", [value]),
    takePostQuarantine: (...args: unknown[]) =>
      call("takePostQuarantine", args),
  };
}
export function cleanAttachMocks() {
  for (const name of [
    "../sourceBindings.js",
    "../operations/sourceOperations.js",
    "../operations/ownedAwait.js",
    "../../../renewalV2/index.js",
    "../c10/attachEvents.js",
    "../operations/fixedTransport.js",
    "../recovery/output.js",
  ])
    vi.doUnmock(name);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
}
