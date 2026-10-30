import { afterEach, expect, it, vi } from "vitest";
import type { EventRecord } from "./ownData.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.doUnmock("./publicApi.js");
  vi.resetModules();
  vi.useRealTimers();
});

async function rig() {
  vi.resetModules();
  const { fixture } = await import("./test-fixtures/fixture.mjs");
  const f = await fixture();
  const start = f.sourceAttach.firstDispatchedAt * 1000;
  const time = { wallMs: start, ns: BigInt(start) * 1_000_000n };
  const basis = {
    startWallMs: start,
    startNs: time.ns,
    workEndWallMs: start + 180_000,
    workEndNs: time.ns + 180_000_000_000n,
    endWallMs: start + 210_000,
    endNs: time.ns + 210_000_000_000n,
  };
  const source = {
    clock: {
      basis,
      sample: () => ({ ...time }),
      subscribeRetirement: () => () => {},
    },
    originalPolicy: {
      firstDispatchedAt: f.sourceAttach.firstDispatchedAt,
      periodStart: f.sourceAttach.firstDispatchedAt - 1,
      periodEnd: f.sourceAttach.firstDispatchedAt + 1000,
    },
    originAssociation: Object.freeze({}),
  };
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => source,
  }));
  const { OWNER } = await import("../originalOwner.js");
  return { f, time, basis, OWNER };
}

const boundaries = [
  ["C1", "prepareRenewalPriceReplacementV2", "attach", "dispatch"],
  ["C2", "prepareRenewalScheduleAttachmentV2", "attach", "dispatch"],
  ["C3", "constructRenewalScheduleAttachmentReceiptV2", "attach", "receipt"],
  ["C6", "projectRenewalConfigurationV2", "configure", "dispatch"],
  ["C9", "constructRenewalConfigurationReceiptV2", "configure", "receipt"],
] as const;

for (const [family, method, stage, branch] of boundaries) {
  it(`actual original owner retirement rejects held real ${family} before the next continuation`, async () => {
    const { f, OWNER } = await rig();
    const api = await import("./publicApi.js");
    const entered = deferred<void>(),
      release = deferred<void>();
    const calls: string[] = [];
    const held: Promise<unknown>[] = [];
    const facade = Object.fromEntries(
      Object.entries(api).map(([name, fn]) => [
        name,
        async (...args: unknown[]) => {
          calls.push(name);
          const value = await Reflect.apply(fn, undefined, args);
          if (name === method) {
            entered.resolve();
            await release.promise;
          }
          return value;
        },
      ]),
    );
    vi.doMock("./publicApi.js", () => facade);
    const { createAttachEventCompiler } = await import("./attachEvents.js");
    const { createConfigureEventCompiler } =
      await import("./configureEvents.js");
    const records: EventRecord[] = [];
    const options = {
      timeoutMs: 5000,
      send(record: EventRecord, ack: (v: unknown) => void) {
        records.push(record);
        ack({ sequence: record.sequence, binding: record.binding });
      },
    };
    const request = stage === "attach" ? f.request : f.configure;
    const compiler =
      stage === "attach"
        ? createAttachEventCompiler(f.sourceAttach, options)
        : createConfigureEventCompiler(f.sourceConfigure, options);
    if (branch === "receipt") {
      await compiler.dispatch({ event: "dispatch", stage, request });
      await compiler.response(
        stage === "attach"
          ? {
              event: "response",
              stage,
              request,
              body: f.s.attach.providerSnapshot,
              status: 200,
            }
          : {
              event: "response",
              stage,
              request,
              body: f.s.configuredBody,
              transport: f.transport,
            },
      );
    }
    const before = records.length;
    const operation =
      branch === "dispatch"
        ? compiler.dispatch({ event: "dispatch", stage, request })
        : compiler.receipt({
            event: "receipt",
            stage,
            request,
            receipt: stage === "attach" ? f.attach : f.stored,
          });
    // A setup refusal must fail this prerequisite rather than hang at the barrier.
    const settled = operation.then(
      () => {
        throw Error("SETTLED_BEFORE_REAL_CONSTRUCTOR_BARRIER");
      },
      () => {
        throw Error("REFUSED_BEFORE_REAL_CONSTRUCTOR_BARRIER");
      },
    );
    held.push(settled.catch(() => {}));
    try {
      await Promise.race([entered.promise, settled]);
      const entries = calls.length;
      OWNER.retire();
      await expect(operation).rejects.toThrow("C10_SOURCE_STOP");
      expect(records).toHaveLength(before);
      release.resolve();
      await Promise.all(held);
      expect(calls).toHaveLength(entries);
      expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
    } finally {
      release.resolve();
      await operation.catch(() => {});
    }
  });
}

it("ACK alone cannot succeed after actual owner retirement while send remains held", async () => {
  const { OWNER } = await rig();
  const { createAppendAckAdapter } = await import("./appendAck.js");
  const { scalarNode } = await import("./eventCodec.js");
  const entered = deferred<void>(),
    release = deferred<void>();
  let sends = 0;
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send(record: EventRecord, ack: (v: unknown) => void) {
      sends++;
      ack({ sequence: record.sequence, binding: record.binding });
      entered.resolve();
      return release.promise;
    },
  });
  const operation = append(scalarNode("ordinary"));
  try {
    await entered.promise;
    OWNER.retire();
    await expect(operation).rejects.toThrow("C10_SOURCE_STOP");
    release.resolve();
    await expect(append(scalarNode("late"))).rejects.toThrow("C10_SOURCE_STOP");
    expect(sends).toBe(1);
  } finally {
    release.resolve();
    await operation.catch(() => {});
  }
});

it.each(["append", "original"] as const)(
  "%s deadline closes held send without resetting the original basis",
  async (limit) => {
    const { OWNER, time, basis } = await rig();
    vi.useFakeTimers();
    if (limit === "original") {
      time.wallMs = basis.workEndWallMs - 20;
      time.ns = basis.workEndNs - 20_000_000n;
    }
    const { createAppendAckAdapter } = await import("./appendAck.js");
    const { scalarNode } = await import("./eventCodec.js");
    const entered = deferred<void>(),
      release = deferred<void>();
    const append = createAppendAckAdapter({
      timeoutMs: limit === "append" ? 25 : 5000,
      send(record: EventRecord, ack: (v: unknown) => void) {
        ack({ sequence: record.sequence, binding: record.binding });
        entered.resolve();
        return release.promise;
      },
    });
    const operation = append(scalarNode("ordinary"));
    const rejection = expect(operation).rejects.toThrow("C10_SOURCE_STOP");
    try {
      await entered.promise;
      const originalBasis = OWNER.basis;
      const delta = limit === "append" ? 25 : 20;
      time.wallMs += delta;
      time.ns += BigInt(delta) * 1_000_000n;
      await vi.advanceTimersByTimeAsync(delta);
      await rejection;
      expect(originalBasis.startWallMs).toBe(basis.startWallMs);
      if (limit === "append") expect(OWNER.check().retired).toBe(false);
      else expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
    } finally {
      release.resolve();
      await operation.catch(() => {});
    }
  },
);

it("retirement at the real C10 digest return prevents actual send", async () => {
  const { OWNER } = await rig();
  const { createAppendAckAdapter } = await import("./appendAck.js");
  const { scalarNode } = await import("./eventCodec.js");
  const original = globalThis.crypto.subtle.digest;
  const entered = deferred<void>(),
    release = deferred<void>();
  let sends = 0,
    realDigests = 0;
  const operations: Promise<ArrayBuffer>[] = [];
  const spy = vi
    .spyOn(globalThis.crypto.subtle, "digest")
    .mockImplementation(function (algorithm, input) {
      // This facade forwards the actual receiver and original bytes without replacement.
      const operation = Reflect.apply(original, globalThis.crypto.subtle, [
        algorithm,
        input,
      ]).then(async (value: ArrayBuffer) => {
        realDigests++;
        entered.resolve();
        await release.promise;
        return value;
      });
      operations.push(operation);
      return operation;
    });
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send() {
      sends++;
    },
  });
  const operation = append(scalarNode("ordinary"));
  const settled = operation.then(
    () => {
      throw Error("SETTLED_BEFORE_DIGEST");
    },
    () => {
      throw Error("REFUSED_BEFORE_DIGEST");
    },
  );
  void settled.catch(() => {});
  try {
    await Promise.race([entered.promise, settled]);
    OWNER.retire();
    await expect(operation).rejects.toThrow("C10_SOURCE_STOP");
    release.resolve();
    await Promise.all(operations);
    expect(realDigests).toBe(1);
    expect(sends).toBe(0);
  } finally {
    release.resolve();
    await operation.catch(() => {});
    await Promise.allSettled(operations);
    spy.mockRestore();
  }
});
