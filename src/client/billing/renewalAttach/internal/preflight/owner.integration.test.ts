import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.resetModules();
});
it("keeps the shared Source defaults empty and unbound without loading an Owner", async () => {
  vi.resetModules();
  let loads = 0;
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource() {
      loads++;
      throw Error("UNBOUND");
    },
  }));
  const source = await import("../operations/sourceOperations.js");
  expect(source.COMPILED_PREFLIGHT_ENTRIES).toEqual([]);
  expect(Object.isFrozen(source.COMPILED_PREFLIGHT_ENTRIES)).toBe(true);
  expect(source.ORIGINAL_ORIGIN_ASSOCIATION).toBe(null);
  expect(() => source.loadOwnedConfigureOperation()).toThrow(
    "CONFIGURE_PREFLIGHT_SOURCE_UNBOUND",
  );
  expect(loads).toBe(0);
});
it("checks the canonical retired Owner before any raw record reflection", async () => {
  vi.resetModules();
  const first = 1768867140;
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => ({
      clock: {
        basis: {
          startWallMs: first * 1000,
          startNs: BigInt(first) * 1000000000n,
          workEndWallMs: (first + 180) * 1000,
          workEndNs: BigInt(first + 180) * 1000000000n,
          endWallMs: (first + 210) * 1000,
          endNs: BigInt(first + 210) * 1000000000n,
        },
        sample: () => ({
          wallMs: first * 1000 + 1,
          ns: BigInt(first) * 1000000000n + 1000000n,
        }),
        subscribeRetirement: () => () => {},
      },
      originalPolicy: {
        firstDispatchedAt: first,
        periodStart: 1768435200,
        periodEnd: 1771113600,
      },
      originAssociation: Object.freeze({}),
    }),
  }));
  const { OWNER } = await import("../originalOwner.js");
  OWNER.check();
  OWNER.retire();
  const { capturePreflightRecord } = await import("./record.js");
  let traps = 0;
  const raw = new Proxy(
    {},
    {
      getPrototypeOf() {
        traps++;
        throw Error("RAW");
      },
      ownKeys() {
        traps++;
        throw Error("RAW");
      },
      getOwnPropertyDescriptor() {
        traps++;
        throw Error("RAW");
      },
      get() {
        traps++;
        throw Error("RAW");
      },
    },
  );
  expect(() => capturePreflightRecord(raw)).toThrow("ORIGINAL_OWNER_STOP");
  expect(traps).toBe(0);
});
// Full capture/invoke continuation and 44-read ownership tests await the real shared
// read binding and Schedule factor; these helper tests do not advertise that API.
