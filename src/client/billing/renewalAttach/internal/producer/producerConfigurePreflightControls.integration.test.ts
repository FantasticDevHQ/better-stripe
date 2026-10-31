import {
  configureAdmissionFixture,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { webcrypto } from "node:crypto";
import { expect, it, vi } from "vitest";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import {
  captureAdmittedConfigurePreflight,
  readAdmittedConfigurePreflight,
} from "./configurePreflight.js";

it("an invalid invoke argument spends the readonly actor without reading or reminting", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const token = await h.core.admitConfigure(child.fresh.call, child.journal);
    h.configureReads(child);
    admissionControls.preflight.push({
      originalEntry: admissionControls.entries[0],
      coversPreflight: () => true,
    });
    const actor = captureAdmittedConfigurePreflight(token),
      before = h.calls.length;
    let traps = 0;
    const input = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error("REPLACEMENT_INVOKED");
        },
      },
    );
    await expect(Reflect.apply(actor.invoke, actor, [input])).rejects.toThrow();
    expect(h.calls).toHaveLength(before);
    expect(traps).toBe(0);
    let refused = false;
    try {
      await actor.invoke();
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    expect(h.calls).toHaveLength(before);
    expect(() => readAdmittedConfigurePreflight(token)).toThrow();
  });
});

it.each([
  "empty",
  "foreign-entry",
  "ambiguous",
  "copy",
  "proxy",
  "extra-capture",
])(
  "refuses %s preflight capture without another selector or provider read",
  async (scenario) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      h.configureReads(child);
      if (scenario !== "empty")
        admissionControls.preflight.push({
          originalEntry:
            scenario === "foreign-entry" ? {} : admissionControls.entries[0],
          coversPreflight: () => true,
        });
      if (scenario === "ambiguous")
        admissionControls.preflight.push({ ...admissionControls.preflight[0] });
      let traps = 0;
      const value =
        scenario === "copy"
          ? { ...token }
          : scenario === "proxy"
            ? new Proxy(token, {
                getPrototypeOf() {
                  traps++;
                  throw Error("PROXY_INVOKED");
                },
              })
            : token;
      const calls = h.calls.length,
        selectors = admissionControls.selectors;
      let refused = false;
      try {
        Reflect.apply(
          captureAdmittedConfigurePreflight,
          undefined,
          scenario === "extra-capture" ? [value, {}] : [value],
        );
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
      expect(traps).toBe(0);
      expect(h.calls).toHaveLength(calls);
      expect(admissionControls.selectors).toBe(selectors);
      if (scenario === "copy" || scenario === "proxy")
        await captureAdmittedConfigurePreflight(token).invoke();
      else expect(() => captureAdmittedConfigurePreflight(token)).toThrow();
    });
  },
);
it("a pending raw read cannot become actual returned preflight custody", async () => {
  let armed = false,
    release!: () => void,
    entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      h.configureReads(child);
      admissionControls.preflight.push({
        originalEntry: admissionControls.entries[0],
        coversPreflight: () => true,
      });
      const actor = captureAdmittedConfigurePreflight(token);
      armed = true;
      let completed = false;
      const pending = actor.invoke().then((value) => {
        completed = true;
        return value;
      });
      try {
        expect(
          await Promise.race([
            reached.then(() => "reached"),
            pending.then(
              () => "resolved",
              (error: unknown) => String(error),
            ),
          ]),
        ).toBe("reached");
        expect(completed).toBe(false);
        expect(() => readAdmittedConfigurePreflight(token)).toThrow();
      } finally {
        release();
      }
      const output = await pending;
      expect(readAdmittedConfigurePreflight(token).output === output).toBe(
        true,
      );
      await expect(actor.invoke()).rejects.toThrow();
    },
    {
      beforeFetch: async (_path, method) => {
        if (armed && method === "GET") {
          armed = false;
          entered();
          await barrier;
        }
      },
    },
  );
});
it("parent retirement rejects a pending read without returning or registering output", async () => {
  let armed = false,
    release!: () => void,
    entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      h.configureReads(child);
      admissionControls.preflight.push({
        originalEntry: admissionControls.entries[0],
        coversPreflight: () => true,
      });
      const actor = captureAdmittedConfigurePreflight(token);
      armed = true;
      const pending = actor.invoke();
      const refused = expect(pending).rejects.toThrow();
      try {
        expect(
          await Promise.race([
            reached.then(() => "reached"),
            pending.then(
              () => "resolved",
              (error: unknown) => String(error),
            ),
          ]),
        ).toBe("reached");
        h.core.owner.retire();
        await refused;
        expect(() => readAdmittedConfigurePreflight(token)).toThrow();
      } finally {
        release();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(() => captureAdmittedConfigurePreflight(token)).toThrow();
    },
    {
      beforeFetch: async (_path, method) => {
        if (armed && method === "GET") {
          armed = false;
          entered();
          await barrier;
        }
      },
    },
  );
});
it.each(["schedule", "coupon", "privacy", "predicate"])(
  "changed %s material refuses without returned output or POST",
  async (scenario) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const current = h.configureReads(child);
      admissionControls.preflight.push({
        originalEntry: admissionControls.entries[0],
        coversPreflight: () => scenario !== "predicate",
      });
      if (scenario === "schedule")
        current.schedule.metadata = { changed: true };
      if (scenario === "coupon")
        current.coupons[0].wireCoupon.times_redeemed = 99;
      if (scenario === "privacy")
        current.subscription.future =
          "Bearer synthetic-preflight-private-control";
      const before = h.calls.length,
        actor = captureAdmittedConfigurePreflight(token);
      await expect(actor.invoke()).rejects.toThrow();
      expect(() => readAdmittedConfigurePreflight(token)).toThrow();
      expect(h.calls.slice(before).every((row) => row.method === "GET")).toBe(
        true,
      );
      expect(admissionControls.legacy).toBe(0);
    });
  },
);
it("copied outputs cannot register custody and changed eligibility cannot revive a cached view", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const token = await h.core.admitConfigure(child.fresh.call, child.journal);
    h.configureReads(child);
    const entry = {
      originalEntry: admissionControls.entries[0],
      coversPreflight: () => true,
    };
    admissionControls.preflight.push(entry);
    const output = await captureAdmittedConfigurePreflight(token).invoke();
    const view = readAdmittedConfigurePreflight(token);
    expect(readAdmittedConfigurePreflight(token) === view).toBe(true);
    const copy = JSON.parse(JSON.stringify(output));
    expect(copy).toEqual(output);
    expect(() =>
      Reflect.apply(readAdmittedConfigurePreflight, undefined, [token, copy]),
    ).toThrow();
    expect(() => readAdmittedConfigurePreflight({ ...token })).toThrow();
    const original = entry.coversPreflight;
    entry.coversPreflight = () => true;
    expect(() => readAdmittedConfigurePreflight(token)).toThrow();
    entry.coversPreflight = original;
    expect(() => readAdmittedConfigurePreflight(token)).toThrow();
  });
});

it("a child intent committed during original reconstruction refuses before any provider reads", async () => {
  let invoking = false,
    armed = false;
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      h.configureReads(child);
      admissionControls.preflight.push({
        originalEntry: admissionControls.entries[0],
        coversPreflight: () => true,
      });
      const actor = captureAdmittedConfigurePreflight(token);
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      const reservation = child.fresh.result.reservation;
      const event = await canonicalJournalEvent(
        1,
        JSON.stringify(
          renewalSnapshot({
            event: "dispatch",
            stage: "configure",
            request: child.record.configureRecord.request,
          }),
        ),
      );
      let release!: () => void,
        entered!: () => void,
        first = true;
      const barrier = new Promise<void>((resolve) => {
          release = resolve;
        }),
        reached = new Promise<void>((resolve) => {
          entered = resolve;
        });
      vi.stubGlobal("crypto", {
        subtle: {
          async digest(
            algorithm: Parameters<typeof webcrypto.subtle.digest>[0],
            input: Parameters<typeof webcrypto.subtle.digest>[1],
          ) {
            const result = await webcrypto.subtle.digest(algorithm, input);
            if (
              armed &&
              first &&
              ArrayBuffer.isView(input) &&
              JSON.parse(
                new TextDecoder().decode(
                  new Uint8Array(
                    input.buffer,
                    input.byteOffset,
                    input.byteLength,
                  ),
                ),
              )[2] === "renewal-configure"
            ) {
              first = false;
              entered();
              await barrier;
            }
            return result;
          },
        },
      });
      invoking = true;
      const before = h.calls.length;
      const pending = actor.invoke(),
        refused = expect(pending).rejects.toThrow();
      try {
        expect(
          await Promise.race([
            reached.then(() => "reached"),
            pending.then(
              () => "resolved",
              (error: unknown) => String(error),
            ),
          ]),
        ).toBe("reached");
        await child.journal.appendStageEvent({
          reservation,
          expectedSequence: 0,
          event: { sequence: 1, binding: event.binding, dataJSON: event.json },
        });
      } finally {
        release();
      }
      await refused;
      expect(h.calls).toHaveLength(before);
      expect(() => readAdmittedConfigurePreflight(token)).toThrow();
    },
    {
      afterQuery: async (_reply, reference) => {
        if (invoking && reference.endsWith("/readAttempt")) armed = true;
      },
    },
  );
});

it("an intent committed during HTTP prevents output custody", async () => {
  let append: (() => Promise<void>) | undefined;
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      h.configureReads(child);
      admissionControls.preflight.push({
        originalEntry: admissionControls.entries[0],
        coversPreflight: () => true,
      });
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      const reservation = child.fresh.result.reservation;
      const event = await canonicalJournalEvent(
        1,
        JSON.stringify(
          renewalSnapshot({
            event: "dispatch",
            stage: "configure",
            request: child.record.configureRecord.request,
          }),
        ),
      );
      append = async () => {
        await child.journal.appendStageEvent({
          reservation,
          expectedSequence: 0,
          event: { sequence: 1, binding: event.binding, dataJSON: event.json },
        });
      };
      const before = h.calls.length;
      await expect(
        captureAdmittedConfigurePreflight(token).invoke(),
      ).rejects.toThrow();
      expect(h.calls.slice(before).every((call) => call.method === "GET")).toBe(
        true,
      );
      expect(() => readAdmittedConfigurePreflight(token)).toThrow();
    },
    {
      beforeFetch: async (_path, method) => {
        if (append && method === "GET") {
          const run = append;
          append = undefined;
          await run();
        }
      },
    },
  );
});

it("preflight keeps original custody across a second genuine Action context", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const token = await h.core.admitConfigure(child.fresh.call, child.journal);
    h.configureReads(child);
    admissionControls.preflight.push({
      originalEntry: admissionControls.entries[0],
      coversPreflight: () => true,
    });
    const actor = captureAdmittedConfigurePreflight(token);
    await h.inAnotherAction(async () => {
      const output = await actor.invoke();
      expect(readAdmittedConfigurePreflight(token).output === output).toBe(
        true,
      );
      expect(
        readAdmittedConfigurePreflight(token).acknowledgement ===
          h.core.attachAcknowledgement(),
      ).toBe(true);
    });
    expect(admissionControls.legacy).toBe(0);
  });
});
