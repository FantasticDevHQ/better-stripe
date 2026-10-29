import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./sourceBindings.js");
  vi.resetModules();
});

function fixture() {
  const basis = {
    startWallMs: 1_000_000,
    startNs: 1_000_000_000n,
    workEndWallMs: 1_180_000,
    workEndNs: 1_180_000_000n,
    endWallMs: 1_210_000,
    endNs: 1_210_000_000n,
  };
  const policy = { firstDispatchedAt: 1000, periodStart: 900, periodEnd: 2000 };
  const sample = { wallMs: basis.startWallMs, ns: basis.startNs };
  let samples = 0;
  let loads = 0;
  let detached = 0;
  let listener = () => {};
  const source = {
    clock: {
      basis,
      sample() {
        samples++;
        return { ...sample };
      },
      subscribeRetirement(fn: () => void) {
        listener = fn;
        return () => {
          detached++;
        };
      },
    },
    originalPolicy: policy,
    originAssociation: Object.freeze({}),
  };
  return {
    basis,
    policy,
    sample,
    source,
    load() {
      loads++;
      return source;
    },
    retire() {
      listener();
    },
    counts() {
      return { samples, loads, detached };
    },
  };
}

async function owner(f = fixture()) {
  vi.resetModules();
  vi.doMock("./sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => f.load(),
  }));
  return { f, OWNER: (await import("./originalOwner.js")).OWNER };
}

it("valid original owner is live with exactly one accepted sample", async () => {
  const { OWNER, f } = await owner();
  let actual: unknown;
  try {
    actual = OWNER.check();
  } catch {
    actual = "stopped";
  }
  expect(actual).toEqual({
    wallMs: 1_000_000,
    ns: 1_000_000_000n,
    nowSeconds: 1000,
    retired: false,
  });
  expect(f.counts()).toEqual({ loads: 1, samples: 1, detached: 0 });
  expect(OWNER.sample).toBe(OWNER.check);
  expect(Object.isFrozen(OWNER)).toBe(true);
});

it("loads lazily once, copies the original basis, and does not sample on basis access", async () => {
  const { OWNER, f } = await owner();
  expect(f.counts().loads).toBe(0);
  const captured = OWNER.basis;
  f.basis.workEndWallMs = 9_000_000;
  expect(OWNER.basis).toBe(captured);
  expect(captured.workEndWallMs).toBe(1_180_000);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(f.counts()).toEqual({ loads: 1, samples: 0, detached: 0 });
});

it.each(["wall", "ns"] as const)(
  "original %s work end is exclusive and irreversibly closes",
  async (clock) => {
    const { OWNER, f } = await owner();
    OWNER.check();
    if (clock === "wall") f.sample.wallMs = f.basis.workEndWallMs;
    else f.sample.ns = f.basis.workEndNs;
    expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
    f.sample.wallMs = f.basis.startWallMs;
    f.sample.ns = f.basis.startNs;
    expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
    expect(f.counts().samples).toBe(2);
  },
);

it.each(["wall", "ns"] as const)(
  "%s regression cannot renew the owner",
  async (clock) => {
    const { OWNER, f } = await owner();
    f.sample.wallMs++;
    f.sample.ns++;
    OWNER.check();
    if (clock === "wall") f.sample.wallMs--;
    else f.sample.ns--;
    expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  },
);

it("derives floor seconds from the same sample and enforces future first dispatch", async () => {
  const f = fixture();
  f.policy.firstDispatchedAt = 1001;
  const { OWNER } = await owner(f);
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  expect(f.counts().samples).toBe(1);
});

it("age 86400 is refused independently under a declared long synthetic basis", async () => {
  const f = fixture();
  f.basis.workEndWallMs = 100_000_000;
  f.basis.endWallMs = 100_001_000;
  f.basis.workEndNs = 100_000_000_000n;
  f.basis.endNs = 100_001_000_000n;
  f.policy.periodEnd = 200_000;
  const { OWNER } = await owner(f);
  f.sample.wallMs = (1000 + 86399) * 1000;
  expect(OWNER.check().nowSeconds).toBe(87399);
  f.sample.wallMs += 1000;
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
});

it("paid period start is inclusive and end exclusive", async () => {
  const f = fixture();
  f.policy.periodStart = 1000;
  f.policy.periodEnd = 1001;
  const { OWNER } = await owner(f);
  expect(OWNER.check().nowSeconds).toBe(1000);
  f.sample.wallMs = 1_001_000;
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
});

it("rejects a Source Proxy before any reflective traps or samples", async () => {
  const f = fixture();
  let traps = 0;
  const value = new Proxy(f.source, {
    getPrototypeOf() {
      traps++;
      return Object.prototype;
    },
    ownKeys() {
      traps++;
      return [];
    },
    get() {
      traps++;
      return null;
    },
  });
  f.load = () => value;
  const { OWNER } = await owner(f);
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  expect(traps).toBe(0);
  expect(f.counts().samples).toBe(0);
});

it("rejects an own accessor without invoking it", async () => {
  const f = fixture();
  let gets = 0;
  Object.defineProperty(f.source, "clock", {
    get() {
      gets++;
      return null;
    },
    enumerable: true,
  });
  const { OWNER } = await owner(f);
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  expect(gets).toBe(0);
});

it("retirement notifies active waiters once and never samples again", async () => {
  const { OWNER, f } = await owner();
  let active = 0;
  let removed = 0;
  OWNER.check();
  OWNER.subscribe(() => {
    active++;
  });
  const unsubscribe = OWNER.subscribe(() => {
    removed++;
  });
  unsubscribe();
  unsubscribe();
  f.retire();
  OWNER.retire();
  expect(active).toBe(1);
  expect(removed).toBe(0);
  expect(f.counts().detached).toBe(1);
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  expect(f.counts().samples).toBe(1);
});

it("cannot revive after a Source loader catches a reentrant check", async () => {
  const f = fixture();
  let nested = () => {};
  const ordinaryLoad = f.load;
  f.load = () => {
    try {
      nested();
    } catch {
      /* The outer load must stay closed. */
    }
    return ordinaryLoad();
  };
  const { OWNER } = await owner(f);
  nested = () => {
    OWNER.check();
  };
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  expect(f.counts().samples).toBe(0);
});

it("cannot revive during listener registration and detaches its returned listener", async () => {
  const f = fixture();
  let nested = () => {};
  let detached = 0;
  f.source.clock.subscribeRetirement = () => {
    try {
      nested();
    } catch {
      /* The registration cannot publish live. */
    }
    return () => {
      detached++;
    };
  };
  const { OWNER } = await owner(f);
  nested = () => {
    OWNER.check();
  };
  expect(() => OWNER.check()).toThrow("ORIGINAL_OWNER_STOP");
  expect(detached).toBe(1);
  expect(f.counts().samples).toBe(0);
});
