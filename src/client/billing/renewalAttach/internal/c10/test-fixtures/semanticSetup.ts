// TEST-only equivalent of the accepted semantic owner/timer port. No runtime binding.
import { beforeEach, afterEach, vi } from "vitest";
import { setTimeout as wake, clearTimeout as cancel } from "node:timers";
const time = vi.hoisted(() => ({ wallMs: 1000, ns: 1000000000n }));
vi.mock("../ownerBinding.js", () => ({
  SOURCE_OWNER: Object.freeze({
    basis: Object.freeze({
      startWallMs: 1000,
      startNs: 1000000000n,
      workEndWallMs: 1000001000,
      workEndNs: 1000001000000000n,
      endWallMs: 1000031000,
      endNs: 1000031000000000n,
    }),
    check() {
      return { wallMs: time.wallMs, ns: time.ns };
    },
    subscribe() {
      return () => {};
    },
  }),
}));
beforeEach(() => {
  time.wallMs = 1000;
  time.ns = 1000000000n;
  vi.stubGlobal("fetch", () => {
    throw Error("NETWORK_FORBIDDEN");
  });
  vi.stubGlobal(
    "setTimeout",
    (fn: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => {
      const wallTarget = time.wallMs + delay,
        nsTarget = time.ns + BigInt(delay) * 1000000n;
      return wake(() => {
        time.wallMs = Math.max(time.wallMs, wallTarget);
        time.ns = time.ns > nsTarget ? time.ns : nsTarget;
        fn(...args);
      }, delay);
    },
  );
  vi.stubGlobal("clearTimeout", cancel);
});
afterEach(() => vi.unstubAllGlobals());
