import assert from "node:assert/strict";
import { vi } from "vitest";
import type {
  ObservationControl,
  ObservationDeclaration,
} from "./observationDeclarations.js";

export function observationState() {
  return {
    targetCalls: 0,
    sourceLoads: 0,
    ownedC6: 0,
    ownedC3: 0,
    C3Fulfilled: 0,
    C3Rejected: 0,
    recordVerificationEntered: 0,
    recordVerificationCompleted: 0,
    ownedC9: 0,
    ownedObserver: 0,
    coverage: 0,
    tupleTraps: 0,
    methodGetterCalls: 0,
    exportFactoryLoads: 0,
    exportReads: 0,
    exportCalls: 0,
    exportProxyApplies: 0,
    exportDescriptorData: false,
    exportDescriptorGetter: false,
    lastC6: null as unknown,
    pending: [] as Promise<unknown>[],
    originals: [] as Promise<unknown>[],
  };
}
export type ObservationState = ReturnType<typeof observationState>;

/** Install only after the actual initial actor/Owner/ACK have been captured. */
export async function observeObservationAPI(
  s: ObservationState,
  owner: typeof import("../originalOwner.js").OWNER,
  mode: ObservationControl,
) {
  const actual = await vi.importActual<
    typeof import("../../../renewalV2/index.js")
  >("../../../renewalV2/index.js");
  const observer = await vi.importActual<
    typeof import("../../../renewalV2/observation.js")
  >("../../../renewalV2/observation.js");
  assert.equal(typeof observer.inspectRenewalScheduleMaterialV2, "function");
  const actualRecord = await vi.importActual<
    typeof import("../observation/record.js")
  >("../observation/record.js");
  const verify = actualRecord.verifyObservationRecord;
  vi.doMock("../observation/record.js", () => ({
    ...actualRecord,
    verifyObservationRecord(...args: Parameters<typeof verify>) {
      s.recordVerificationEntered++;
      const result = Reflect.apply(verify, actualRecord, args) as ReturnType<
        typeof verify
      >;
      s.recordVerificationCompleted++;
      return result;
    },
  }));
  const keep = <T>(promise: Promise<T>) => {
    s.originals.push(promise);
    s.pending.push(
      promise.then(
        () => {},
        () => {},
      ),
    );
    return promise;
  };
  vi.doMock("../../../renewalV2/index.js", () => ({
    ...actual,
    projectRenewalConfigurationV2(
      ...args: Parameters<typeof actual.projectRenewalConfigurationV2>
    ) {
      s.ownedC6++;
      const promise = Reflect.apply(
        actual.projectRenewalConfigurationV2,
        actual,
        args,
      ) as ReturnType<typeof actual.projectRenewalConfigurationV2>;
      s.pending.push(
        promise.then(
          (value) => {
            s.lastC6 = value;
            if (mode === "G03-retire") owner.retire();
          },
          () => {},
        ),
      );
      return keep(promise);
    },
    constructRenewalScheduleAttachmentReceiptV2(
      ...args: Parameters<
        typeof actual.constructRenewalScheduleAttachmentReceiptV2
      >
    ) {
      s.ownedC3++;
      const promise = Reflect.apply(
        actual.constructRenewalScheduleAttachmentReceiptV2,
        actual,
        args,
      ) as ReturnType<
        typeof actual.constructRenewalScheduleAttachmentReceiptV2
      >;
      s.pending.push(
        promise.then(
          () => {
            s.C3Fulfilled++;
          },
          () => {
            s.C3Rejected++;
          },
        ),
      );
      return keep(promise);
    },
    constructRenewalConfigurationReceiptV2(
      ...args: Parameters<typeof actual.constructRenewalConfigurationReceiptV2>
    ) {
      s.ownedC9++;
      return keep(
        Reflect.apply(
          actual.constructRenewalConfigurationReceiptV2,
          actual,
          args,
        ) as ReturnType<typeof actual.constructRenewalConfigurationReceiptV2>,
      );
    },
  }));
  vi.doMock("../../../renewalV2/observation.js", () => ({
    ...observer,
    inspectRenewalScheduleMaterialV2(
      ...args: Parameters<typeof observer.inspectRenewalScheduleMaterialV2>
    ) {
      s.ownedObserver++;
      return keep(
        Reflect.apply(
          observer.inspectRenewalScheduleMaterialV2,
          observer,
          args,
        ) as ReturnType<typeof observer.inspectRenewalScheduleMaterialV2>,
      );
    },
  }));
  return Object.freeze({ configuration: actual, observation: observer });
}
export function cleanObservationAPI() {
  vi.doUnmock("../../../renewalV2/observation.js");
  vi.doUnmock("../observation/record.js");
  vi.doUnmock("../material/classifiers.js");
}
export async function joinObservationWork(s: ObservationState) {
  const joined = await Promise.allSettled(s.pending);
  assert.equal(joined.length, s.pending.length);
}

/** Fixed TEST export variants after genuine initial ACK; default positive is unmocked SSR. */
export async function installTrustedExportCase(
  s: ObservationState,
  owner: typeof import("../originalOwner.js").OWNER,
  declaration: ObservationDeclaration,
) {
  const mode = declaration.controlCase;
  if (!mode.startsWith("ABI-") && mode !== "G03-failure") return;
  const actual = await vi.importActual<
    typeof import("../material/classifiers.js")
  >("../material/classifiers.js");
  const classify = actual.classifyOwnedRetainedInitialAttachment;
  vi.doMock("../material/classifiers.js", () => {
    s.exportFactoryLoads++;
    const forward = (...args: Parameters<typeof classify>) => {
      s.exportCalls++;
      const promise = Reflect.apply(classify, actual, args) as ReturnType<
        typeof classify
      >;
      s.pending.push(
        promise.then(
          () => {},
          () => {},
        ),
      );
      return promise;
    };
    const namespace = { ...actual };
    let value: unknown = forward;
    if (mode === "ABI-undefined-export") value = undefined;
    if (mode === "ABI-nonfunction-export")
      value = Object.freeze({ declared: "NOT_A_FUNCTION" });
    if (mode === "ABI-proxy-function-export")
      value = new Proxy(forward, {
        apply(target, receiver, args: Parameters<typeof classify>) {
          s.exportProxyApplies++;
          return Reflect.apply(target, receiver, args);
        },
      });
    if (
      [
        "ABI-getter-once",
        "ABI-getter-retire",
        "ABI-getter-throws",
        "G03-failure",
      ].includes(mode)
    )
      Object.defineProperty(
        namespace,
        "classifyOwnedRetainedInitialAttachment",
        {
          enumerable: true,
          configurable: true,
          get() {
            s.exportReads++;
            if (mode === "ABI-getter-retire") owner.retire();
            if (mode === "ABI-getter-throws" || mode === "G03-failure")
              throw Error(declaration.exportThrow);
            return forward;
          },
        },
      );
    else
      Object.defineProperty(
        namespace,
        "classifyOwnedRetainedInitialAttachment",
        {
          enumerable: true,
          configurable: true,
          value,
        },
      );
    return namespace;
  });
  if (mode.startsWith("ABI-")) {
    const resolved = await import("../material/classifiers.js");
    const descriptor = Object.getOwnPropertyDescriptor(
      resolved,
      "classifyOwnedRetainedInitialAttachment",
    );
    assert(descriptor, "TRUSTED_EXPORT_VARIANT_MUST_RESOLVE");
    s.exportDescriptorData = Object.prototype.hasOwnProperty.call(
      descriptor,
      "value",
    );
    s.exportDescriptorGetter = typeof descriptor.get === "function";
    const getter = [
      "ABI-getter-once",
      "ABI-getter-retire",
      "ABI-getter-throws",
    ].includes(mode);
    assert.equal(
      s.exportDescriptorGetter,
      getter,
      "DECLARED_ABI_SHAPE_BEFORE_TARGET",
    );
    assert.equal(
      s.exportDescriptorData,
      !getter,
      "DECLARED_ABI_SHAPE_BEFORE_TARGET",
    );
    assert.equal(
      s.exportReads,
      0,
      "descriptor inspection never invokes getter",
    );
    assert.equal(s.exportCalls, 0);
  }
}
