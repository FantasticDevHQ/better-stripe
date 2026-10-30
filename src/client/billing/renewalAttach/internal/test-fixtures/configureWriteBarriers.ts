import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { vi } from "vitest";

export function configureWriteBarriers() {
  const pending: Promise<unknown>[] = [];
  const waiting = new Map<
    string,
    {
      entered: Promise<void>;
      signal: () => void;
      release: () => void;
      released: Promise<void>;
    }
  >();
  const cell = (key: string) => {
    let value = waiting.get(key);
    if (!value) {
      let signal!: () => void, release!: () => void;
      const entered = new Promise<void>((r) => {
        signal = r;
      });
      const released = new Promise<void>((r) => {
        release = r;
      });
      value = { entered, signal, release, released };
      waiting.set(key, value);
    }
    return value;
  };
  const activeDigests = new Set<Promise<unknown>>();
  return {
    pending,
    activeDigests,
    async hold(key: string) {
      const c = cell(key);
      c.signal();
      await c.released;
    },
    async entered(key: string, operation: Promise<unknown>) {
      const settled = operation.then(
        () => false,
        () => false,
      );
      assert.equal(
        await Promise.race([cell(key).entered.then(() => true), settled]),
        true,
        "WRITE_SETTLED_BEFORE_DECLARED_BARRIER",
      );
    },
    release(key: string) {
      cell(key).release();
    },
    async cleanup() {
      try {
        for (const c of waiting.values()) c.release();
        await Promise.allSettled(pending);
        assert.equal(activeDigests.size, 0);
      } finally {
        vi.doUnmock("../configure/transport.js");
        vi.doUnmock("../acquisition/ownedAcquisition.js");
      }
    },
  };
}

/** Real native digest receiver and arguments; observed continuations are all joined. */
export function installWriteDigestAccounting(
  gates: ReturnType<typeof configureWriteBarriers>,
) {
  vi.stubGlobal("crypto", {
    subtle: {
      digest(...args: Parameters<typeof webcrypto.subtle.digest>) {
        const [algorithm, input] = args;
        assert.equal(
          typeof algorithm === "string" ? algorithm : algorithm.name,
          "SHA-256",
        );
        assert(ArrayBuffer.isView(input));
        const tuple: unknown = JSON.parse(
          new TextDecoder().decode(
            new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
          ),
        );
        assert(Array.isArray(tuple));
        // Public renewal bindings and C10 event digests use distinct fixed domains.
        assert.equal(tuple.length, 4);
        assert.equal(tuple[0], "betterstripe-renewal-binding");
        assert.equal(tuple[1], 2);
        assert.equal(typeof tuple[2], "string");
        assert(
          new Set([
            "renewal",
            "renewal-attach",
            "renewal-attach-receipt",
            "renewal-baseline",
            "renewal-defaults",
            "renewal-configure",
            "renewal-configured-baseline",
            "renewal-configured-defaults",
            "renewal-configure-receipt",
            "unbound-qualification-event",
          ]).has(tuple[2]),
        );
        const actual = Reflect.apply(
          webcrypto.subtle.digest,
          webcrypto.subtle,
          args,
        ) as ReturnType<typeof webcrypto.subtle.digest>;
        gates.activeDigests.add(actual);
        gates.pending.push(
          actual.then(
            () => {
              gates.activeDigests.delete(actual);
            },
            () => {
              gates.activeDigests.delete(actual);
            },
          ),
        );
        return actual;
      },
    },
  });
}
