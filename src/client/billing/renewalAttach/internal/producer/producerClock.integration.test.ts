import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import {
  INITIAL_NS,
  INITIAL_WALL,
  WORK_WALL,
} from "../test-fixtures/producerInitialDeclarations.js";
import { captureInitialInvocationCore } from "./invocationProducer.js";

const timerLimit = 2147483647;
let monotonic = INITIAL_NS;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(INITIAL_WALL);
  monotonic = INITIAL_NS;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => monotonic);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("accepts a capture aperture above 1 ms inside the original cutoffs", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    monotonic = INITIAL_NS + 2000000n;
    vi.mocked(process.hrtime.bigint).mockReturnValueOnce(INITIAL_NS);
    const core = await captureInitialInvocationCore(fresh.call, journal);
    try {
      expect(core.owner.basis.startNs).toBe(INITIAL_NS);
      expect(core.owner.basis.workEndNs).toBe(INITIAL_NS + 3000000000n);
      expect(core.owner.check().ns).toBe(monotonic);
    } finally {
      core.owner.retire();
    }
  });
});

it("refuses a capture reaching the projected work cutoff before binding", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    monotonic = INITIAL_NS + 3000000000n;
    vi.mocked(process.hrtime.bigint).mockReturnValueOnce(INITIAL_NS);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    const stored = await journal.loadAuthorizedOperation();
    assert(stored && "initialBasis" in stored);
    expect(stored.initialBasis).toBeNull();
    monotonic = INITIAL_NS;
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
  });
});

it("accepts a short work timer with a final deadline beyond Node's timer range", async () => {
  await initialOperations(
    async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      expect(core.owner.basis.endWallMs).toBe(INITIAL_WALL + timerLimit + 1000);
      vi.advanceTimersByTime(WORK_WALL - INITIAL_WALL);
      expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
    },
    1,
    { endWallMs: INITIAL_WALL + timerLimit + 1000 },
  );
});

it("chunks long work timers and rechecks unchanged cutoffs on each callback", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  vi.spyOn(Date, "now").mockReturnValue(INITIAL_WALL);
  await initialOperations(
    async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        const basis = core.owner.basis;
        expect(timers.mock.calls[timers.mock.calls.length - 1]?.[1]).toBe(
          timerLimit,
        );
        // Deliver a chunk while the two independent clocks still have work left.
        vi.advanceTimersByTime(timerLimit);
        expect(core.owner.basis).toBe(basis);
        expect(timers.mock.calls[timers.mock.calls.length - 1]?.[1]).toBe(
          timerLimit,
        );
        expect(core.owner.check().retired).toBe(false);
        monotonic = basis.workEndNs;
        vi.advanceTimersByTime(timerLimit);
        expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    {
      workEndWallMs: INITIAL_WALL + timerLimit + 1000,
      endWallMs: INITIAL_WALL + timerLimit + 2000,
    },
  );
});

it("schedules the earlier monotonic cutoff after a wide capture", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  await initialOperations(async ({ fresh, journal }) => {
    monotonic = INITIAL_NS + 2000000000n;
    vi.mocked(process.hrtime.bigint).mockReturnValueOnce(INITIAL_NS);
    const core = await captureInitialInvocationCore(fresh.call, journal);
    expect(timers.mock.calls[timers.mock.calls.length - 1]?.[1]).toBe(1000);
    monotonic = core.owner.basis.workEndNs;
    vi.advanceTimersByTime(1000);
    expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
  });
});

it("checks the original cutoff after an actual basis mutation is delayed", async () => {
  let reached = () => {};
  let release = () => {};
  const binding = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await initialOperations(
    async ({ fresh, journal }) => {
      const pending = captureInitialInvocationCore(fresh.call, journal);
      const refused = expect(pending).rejects.toThrow("INITIAL_OWNER_STOP");
      await binding;
      const stored = await journal.loadAuthorizedOperation();
      assert(stored && "initialBasis" in stored && stored.initialBasis);
      const original = stored.initialBasis.basisJSON;
      vi.setSystemTime(WORK_WALL);
      monotonic = INITIAL_NS + 3000000000n;
      release();
      await refused;
      const after = await journal.loadAuthorizedOperation();
      assert(after && "initialBasis" in after);
      expect(after.initialBasis?.basisJSON).toBe(original);
      await expect(
        captureInitialInvocationCore(fresh.call, journal),
      ).rejects.toThrow();
    },
    1,
    {
      afterBind: async () => {
        reached();
        await delayed;
      },
    },
  );
});

it("constructs and binds using real Node wall and monotonic clocks", async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  const epochMs = Date.now();
  await initialOperations(
    async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(core.owner.basis.startWallMs).toBeGreaterThanOrEqual(epochMs);
        expect(core.owner.check().retired).toBe(false);
        const stored = await journal.loadAuthorizedOperation();
        assert(stored && "initialBasis" in stored);
        expect(stored.initialBasis?.basisJSON).toBe(core.basisJSON);
      } finally {
        core.owner.retire();
      }
    },
    1,
    { epochMs },
  );
});
