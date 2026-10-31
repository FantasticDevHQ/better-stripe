import assert from "node:assert/strict";
import Stripe from "stripe";
import { getStripeClient } from "../../../../helpers.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import {
  captureInitialInvocationCore,
  type InitialInvocationCore,
} from "./invocationProducer.js";
import {
  INITIAL_WALL,
  INITIAL_NS,
  WORK_WALL,
} from "../test-fixtures/producerInitialDeclarations.js";

let monotonic = INITIAL_NS;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(INITIAL_WALL);
  monotonic = INITIAL_NS;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => monotonic);
});

it.each(["wall", "monotonic"] as const)(
  "%s regression irreversibly retires only its Owner",
  async (clock) => {
    await initialOperations(async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      vi.setSystemTime(INITIAL_WALL + 1);
      monotonic = INITIAL_NS + 1n;
      core.owner.check();
      if (clock === "wall") vi.setSystemTime(INITIAL_WALL);
      else monotonic = INITIAL_NS;
      expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
      vi.setSystemTime(INITIAL_WALL + 2);
      monotonic = INITIAL_NS + 2n;
      expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
    });
  },
);

it.each(["wall", "monotonic"] as const)(
  "the %s work cutoff independently refuses at equality",
  async (clock) => {
    await initialOperations(async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      if (clock === "wall") vi.setSystemTime(WORK_WALL);
      else monotonic = core.owner.basis.workEndNs;
      expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
      expect(() => core.owned(() => "unreachable")).toThrow();
    });
  },
);

it("rejects an extra replacement-client argument before clocks and spends custody", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const foreignClient = new Stripe("sk_test_invalid_foreign_owner_core");
    const now = vi.spyOn(Date, "now");
    const before = now.mock.calls.length;
    await expect(
      Reflect.apply(captureInitialInvocationCore, undefined, [
        fresh.call,
        journal,
        foreignClient,
      ]),
    ).rejects.toThrow();
    expect(now.mock.calls.length).toBe(before);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
  });
});

it.each(["wide aperture", "u64 overflow"] as const)(
  "rejects %s without binding a replacement basis",
  async (reason) => {
    await initialOperations(async ({ fresh, journal }) => {
      const read = vi.mocked(process.hrtime.bigint);
      if (reason === "wide aperture") {
        read
          .mockReturnValueOnce(INITIAL_NS)
          .mockReturnValueOnce(INITIAL_NS + 1000001n);
      } else monotonic = 18446744073709551615n - 1n;
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
  },
);

it("does not mint from an existing component result or a copied handle", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    assert(fresh.result.disposition === "acquired");
    const reservation = fresh.result.reservation;
    const existing = await journal.reserveFreshAttempt({
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: reservation.requestBinding,
      recordJSON: reservation.recordJSON,
    });
    expect(existing.call).toBeNull();
    await expect(
      captureInitialInvocationCore(existing.result, journal),
    ).rejects.toThrow();
    await expect(
      captureInitialInvocationCore({ ...fresh.call }, journal),
    ).rejects.toThrow();
    const core = await captureInitialInvocationCore(fresh.call, journal);
    expect(core.owner.check().retired).toBe(false);
    core.owner.retire();
  });
});

it("refuses descriptor-only configuration drift without reading a clock", async () => {
  await initialOperations(async ({ fresh, journal, sdk }) => {
    const before = Object.getOwnPropertyDescriptor(sdk, "stripeApiVersion");
    assert(before);
    const now = vi.spyOn(Date, "now");
    const calls = now.mock.calls.length;
    Object.defineProperty(sdk, "stripeApiVersion", {
      ...before,
      writable: false,
    });
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    expect(now.mock.calls.length).toBe(calls);
    Object.defineProperty(sdk, "stripeApiVersion", before);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("retains the selected stock method receiver through controlled HTTP despite a foreign call receiver", async () => {
  await initialOperations(async ({ fresh, journal, sdk }) => {
    const requests: {
      method: string | undefined;
      authorization: string | null;
      version: string | null;
      redirect: RequestRedirect | undefined;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requests.push({
          method: init?.method,
          authorization: headers.get("authorization"),
          version: headers.get("stripe-version"),
          redirect: init?.redirect,
        });
        return new Response(
          JSON.stringify({
            id: "sub_owner_receiver_probe",
            object: "subscription",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "request-id": "req_owner_receiver_probe",
            },
          },
        );
      },
    );
    const foreign = getStripeClient(
      "sk_test_invalid_foreign_receiver",
      sdk.stripeApiVersion,
      { singleAttempt: true },
    );
    const core = await captureInitialInvocationCore(fresh.call, journal);
    try {
      const reply = await core.delegate.rawRequest.call(
        foreign,
        "GET",
        "/v1/subscriptions/sub_owner_receiver_probe",
        undefined,
        {
          apiVersion: sdk.stripeApiVersion,
          maxNetworkRetries: 0,
        },
      );
      expect(reply).toMatchObject({
        id: "sub_owner_receiver_probe",
        object: "subscription",
      });
      expect(requests).toEqual([
        {
          method: "GET",
          authorization: "Bearer sk_test_invalid_owner_core",
          version: sdk.stripeApiVersion,
          redirect: "error",
        },
      ]);
      core.owner.retire();
      expect(() =>
        core.delegate.rawRequest(
          "GET",
          "/v1/subscriptions/sub_owner_receiver_probe",
        ),
      ).toThrow("INITIAL_OWNER_STOP");
      expect(requests).toHaveLength(1);
    } finally {
      core.owner.retire();
    }
  });
});

it("binds the actual fresh call to an isolated Owner with the original absolute cutoffs", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    expect(core).not.toBeNull();
    assert(core);
    const basis = core.owner.basis;
    expect(basis.startWallMs).toBe(1700000002000);
    expect(basis.workEndWallMs).toBe(1700000005000);
    expect(basis.endWallMs).toBe(1700000006000);
    expect(basis.workEndNs - basis.startNs).toBe(3000000000n);
    expect(basis.endNs - basis.startNs).toBe(4000000000n);
    expect(core.operationalAuthority).toBe(false);
    expect(core.owner.sample).toBe(core.owner.check);
    expect(core.owner.check()).toMatchObject({
      nowSeconds: 1700000002,
      retired: false,
    });
    const stored = await journal.loadAuthorizedOperation();
    assert(stored && "initialBasis" in stored);
    expect(stored.initialBasis?.basisJSON).toBe(core.basisJSON);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    core.owner.retire();
    expect(() => core.owner.check()).toThrow();
  });
});

it("retiring one operation does not retire a second Owner or its pending work", async () => {
  const cores: InitialInvocationCore[] = [];
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    assert(core);
    cores.push(core);
    if (cores.length !== 2) return;
    const [first, second] = cores;
    expect(first.owner).not.toBe(second.owner);
    let resolve = (_value: string) => {};
    const work = new Promise<string>((done) => {
      resolve = done;
    });
    const stopped = first.owned(() => work);
    const live = second.owned(() => work);
    const rejection = expect(stopped).rejects.toThrow();
    first.owner.retire();
    await rejection;
    expect(second.owner.check().retired).toBe(false);
    resolve("complete");
    await expect(live).resolves.toBe("complete");
    second.owner.retire();
  }, 2);
});

it("refuses changed SDK configuration after reservation and spends the winning call", async () => {
  await initialOperations(async ({ fresh, journal, sdk }) => {
    const original = Object.getOwnPropertyDescriptor(sdk, "_apiKey");
    assert(original);
    let reads = 0;
    Object.defineProperty(sdk, "_apiKey", {
      configurable: true,
      enumerable: true,
      get() {
        reads++;
        throw Error("SELECTOR_TOUCHED");
      },
    });
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    expect(reads).toBe(0);
    Object.defineProperty(sdk, "_apiKey", original);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    const stored = await journal.loadAuthorizedOperation();
    assert(stored && "initialBasis" in stored);
    expect(stored.initialBasis).toBeNull();
  });
});

it("work deadline retirement is exclusive, irreversible and not reset by a backward wall jump", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    assert(core);
    let retired = 0;
    core.owner.subscribe(() => {
      retired++;
    });
    vi.advanceTimersByTime(3000);
    expect(retired).toBe(1);
    expect(() => core.owner.check()).toThrow();
    vi.setSystemTime(1700000002000);
    expect(() => core.owner.check()).toThrow();
    core.owner.retire();
    expect(retired).toBe(1);
  });
});

it("two overlapping registered-Action operations keep distinct canonical Owners", async () => {
  const cores: InitialInvocationCore[] = [];
  let release = () => {};
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    cores.push(core);
    if (cores.length === 2) release();
    await both;
    expect(cores).toHaveLength(2);
    expect(cores[0].owner).not.toBe(cores[1].owner);
    expect(cores[0].owner.basis).not.toBe(cores[1].owner.basis);
    expect(
      await core.owned(async () => {
        await Promise.resolve();
        return core.owner.check().nowSeconds;
      }),
    ).toBe(1700000002);
    core.owner.retire();
  }, 2);
});

it("configuration drift during a continuation closes the Owner before returning a value", async () => {
  await initialOperations(async ({ fresh, journal, sdk }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    const descriptor = Object.getOwnPropertyDescriptor(sdk, "_apiKey");
    assert(descriptor);
    let release = () => {};
    const pending = core.owned(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("must not return");
        }),
    );
    const rejection = expect(pending).rejects.toThrow("INITIAL_OWNER_STOP");
    Object.defineProperty(sdk, "_apiKey", {
      ...descriptor,
      value: "sk_test_other_root_configuration",
    });
    release();
    await rejection;
    Object.defineProperty(sdk, "_apiKey", descriptor);
    expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
  });
});

it("refuses a conflicting already-bound basis without changing retained history", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    assert(fresh.result.disposition === "acquired");
    const reservation = fresh.result.reservation;
    assert("timingPolicyJSON" in reservation);
    await journal.bindInitialBasis({
      attemptId: reservation.attemptId,
      policyJSON: reservation.timingPolicyJSON,
      basisJSON: JSON.stringify({
        startWallMs: INITIAL_WALL,
        startNsDecimal: "100",
        workEndWallMs: WORK_WALL,
        workEndNsDecimal: "3000000100",
        endWallMs: 1700000006000,
        endNsDecimal: "4000000100",
      }),
    });
    const before = await journal.loadAuthorizedOperation();
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    expect(await journal.loadAuthorizedOperation()).toEqual(before);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
  });
});

it("keeps duplicate waiter registrations independent and notifies each once", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    let calls = 0;
    const waiter = () => {
      calls++;
    };
    core.owner.subscribe(waiter);
    core.owner.subscribe(waiter);
    const remove = core.owner.subscribe(waiter);
    remove();
    remove();
    core.owner.retire();
    expect(calls).toBe(2);
    core.owner.retire();
    expect(calls).toBe(2);
    core.owner.subscribe(waiter);
    expect(calls).toBe(3);
  });
});

it("refuses a monotonic regression below the high capture sample before basis binding", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    vi.mocked(process.hrtime.bigint)
      .mockReturnValueOnce(INITIAL_NS)
      .mockReturnValueOnce(INITIAL_NS + 100n);
    await expect(
      captureInitialInvocationCore(fresh.call, journal),
    ).rejects.toThrow();
    const stored = await journal.loadAuthorizedOperation();
    assert(stored && "initialBasis" in stored);
    expect(stored.initialBasis).toBeNull();
  });
});

it("notifies waiters without exposing a callback receiver", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    const receivers: unknown[] = [];
    core.owner.subscribe(function (this: unknown) {
      receivers.push(this);
    });
    core.owner.retire();
    expect(receivers).toEqual([undefined]);
  });
});

it("rejects proxy waiters without invoking their apply trap", async () => {
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    let traps = 0;
    const proxy = new Proxy(() => {}, {
      apply() {
        traps++;
      },
    });
    expect(() => core.owner.subscribe(proxy)).toThrow("INITIAL_OWNER_STOP");
    expect(traps).toBe(0);
    expect(() => core.owner.check()).toThrow("INITIAL_OWNER_STOP");
  });
});
