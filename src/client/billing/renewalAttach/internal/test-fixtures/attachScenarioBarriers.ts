import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { vi } from "vitest";
export function data(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
export function list(value: unknown): Record<string, unknown>[] {
  assert(Array.isArray(value));
  return value.map(data);
}
export function metrics(value: unknown) {
  const text = JSON.stringify(value);
  assert.equal(typeof text, "string");
  let nodes = 0,
    depth = 0;
  const active = new Set<object>();
  function visit(v: unknown, d: number) {
    nodes++;
    depth = Math.max(depth, d);
    if (v && typeof v === "object") {
      assert(!active.has(v));
      active.add(v);
      for (const child of Object.values(v)) visit(child, d + 1);
      active.delete(v);
    }
  }
  visit(value, 0);
  return {
    chars: text.length,
    bytes: new TextEncoder().encode(text).length,
    nodes,
    depth,
  };
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export function barriers() {
  const rows = new Map<
    string,
    {
      entered: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    }
  >();
  const get = (name: string) => {
    let value = rows.get(name);
    if (!value) {
      value = { entered: deferred(), release: deferred() };
      rows.set(name, value);
    }
    return value;
  };
  return {
    get,
    async hold(name: string) {
      const value = get(name);
      value.entered.resolve();
      await value.release.promise;
    },
    release(name: string) {
      get(name).release.resolve();
    },
    releaseAll() {
      for (const value of rows.values()) value.release.resolve();
    },
  };
}
export type Barriers = ReturnType<typeof barriers>;
export function installDigestBarrier(
  state: {
    recovering: boolean;
    phase: string;
    replay: boolean;
    digestHeld: boolean;
    observerErrors: unknown[];
    pending: Promise<unknown>[];
  },
  name: string,
  gates: Barriers,
) {
  let digests = 0;
  vi.stubGlobal("crypto", {
    subtle: {
      digest(
        algorithm: Parameters<typeof webcrypto.subtle.digest>[0],
        input: Parameters<typeof webcrypto.subtle.digest>[1],
      ) {
        const actual = webcrypto.subtle.digest(algorithm, input);
        const observed = actual.then(async (value) => {
          if (!state.recovering) return value;
          const index = ++digests;
          let hold =
            (name === "G07-retire" || name === "G10-delivery") && index === 1;
          hold ||= name === "G07-C2" && state.phase === "C2";
          hold ||= name === "G07-replay" && state.replay;
          hold ||= name === "G07-C3" && state.phase === "C3";
          if (name === "G07-C10") {
            try {
              assert(ArrayBuffer.isView(input) && input.byteLength <= 500000);
              const tuple: unknown = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  new Uint8Array(
                    input.buffer,
                    input.byteOffset,
                    input.byteLength,
                  ),
                ),
              );
              assert(Array.isArray(tuple));
              hold ||=
                tuple[2] === "unbound-qualification-event" &&
                data(tuple[3]).sequence === 1;
            } catch (error) {
              state.observerErrors.push(error);
            }
          }
          if (hold && !state.digestHeld) {
            state.digestHeld = true;
            await gates.hold("B_DIGEST");
          }
          return value;
        });
        state.pending.push(observed.catch(() => {}));
        return observed;
      },
    },
  });
}
export type Observed =
  { ok: true; value: Record<string, unknown> } | { ok: false; error: Error };
export const observe = (p: Promise<unknown>): Promise<Observed> =>
  p.then(
    (value) => ({ ok: true, value: data(value) }),
    (error: unknown) => {
      assert(error instanceof Error);
      return { ok: false, error };
    },
  );
