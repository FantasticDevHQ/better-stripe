import {
  configureAdmissionFixture,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import { expect, it, vi } from "vitest";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { getFunctionAddress } from "convex/server";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { readConfigureLineage } from "./configureLineage.js";
import { createGuardedInitialStageChannel } from "../c10/appendAck.js";
import { createAdmittedConfigureEventCompiler } from "../c10/configureEvents.js";
import { journalWorkForConfigureLineage } from "./configureJournalWork.js";

it.each(["before", "after"])(
  "does not acknowledge a child append while the %s-commit RPC barrier is pending",
  async (phase) => {
    let release!: () => void,
      entered!: () => void,
      armed = false;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const block = async () => {
      if (armed) {
        entered();
        await barrier;
      }
    };
    await configureAdmissionFixture(
      async (h) => {
        await h.complete();
        const child = await h.child();
        const token = await h.core.admitConfigure(
          child.fresh.call,
          child.journal,
        );
        const compiler = createAdmittedConfigureEventCompiler(token),
          values = await h.eventsFor(child);
        const work = journalWorkForConfigureLineage(token);
        armed = true;
        let completed = false;
        const dispatched = compiler.dispatch(values.dispatch).then((value) => {
          completed = true;
          return value;
        });
        try {
          await reached;
          expect(work.idle()).toBe(false);
          expect(completed).toBe(false);
          if (child.fresh.result.disposition !== "acquired")
            throw Error("INVALID_FIXTURE_CAS");
          const stored = await child.journal.readAttempt({
            attemptId: child.fresh.result.reservation.attemptId,
          });
          expect(stored?.events).toHaveLength(phase === "before" ? 0 : 1);
        } finally {
          release();
        }
        const result = await dispatched;
        expect(result.actualFulfillmentEstablished).toBe(false);
        expect(completed).toBe(true);
        expect(work.idle()).toBe(true);
        expect(admissionControls.legacy).toBe(0);
      },
      phase === "before" ? { beforeAppend: block } : { afterAppend: block },
    );
  },
);
it.each(["before", "after"])(
  "a rejected %s-commit append closes the child channel without another capture",
  async (phase) => {
    let armed = false;
    const reject = async () => {
      if (armed) throw Error("CONTROLLED_APPEND_REJECTION");
    };
    await configureAdmissionFixture(
      async (h) => {
        await h.complete();
        const child = await h.child();
        const token = await h.core.admitConfigure(
          child.fresh.call,
          child.journal,
        );
        const compiler = createAdmittedConfigureEventCompiler(token),
          values = await h.eventsFor(child);
        armed = true;
        await expect(compiler.dispatch(values.dispatch)).rejects.toThrow(
          "C10_SOURCE_STOP",
        );
        expect(journalWorkForConfigureLineage(token).idle()).toBe(true);
        expect(() => createAdmittedConfigureEventCompiler(token)).toThrow(
          "CONFIGURE_CHANNEL_CONSUMED",
        );
        await expect(compiler.dispatch(values.dispatch)).rejects.toThrow(
          "C10_SOURCE_STOP",
        );
        if (child.fresh.result.disposition !== "acquired")
          throw Error("INVALID_FIXTURE_CAS");
        expect(
          (
            await child.journal.readAttempt({
              attemptId: child.fresh.result.reservation.attemptId,
            })
          )?.events,
        ).toHaveLength(phase === "before" ? 0 : 1);
      },
      phase === "before" ? { beforeAppend: reject } : { afterAppend: reject },
    );
  },
);
it("a channel timeout cannot hide the actual pending RPC or accept its late reply", async () => {
  let release!: () => void,
    entered!: () => void,
    armed = false;
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
      const compiler = createAdmittedConfigureEventCompiler(token),
        values = await h.eventsFor(child);
      const work = journalWorkForConfigureLineage(token);
      armed = true;
      const dispatched = compiler.dispatch(values.dispatch);
      const refused = expect(dispatched).rejects.toThrow("C10_SOURCE_STOP");
      try {
        await reached;
        expect(work.idle()).toBe(false);
        await vi.advanceTimersByTimeAsync(5000);
        await refused;
        expect(() => h.core.owner.check()).not.toThrow();
        expect(work.idle()).toBe(false);
        expect(() => createAdmittedConfigureEventCompiler(token)).toThrow(
          "CONFIGURE_CHANNEL_CONSUMED",
        );
      } finally {
        release();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(work.idle()).toBe(true);
      await expect(compiler.response(values.response)).rejects.toThrow(
        "C10_SOURCE_STOP",
      );
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      expect(
        (
          await child.journal.readAttempt({
            attemptId: child.fresh.result.reservation.attemptId,
          })
        )?.events,
      ).toHaveLength(1);
    },
    {
      afterAppend: async () => {
        if (armed) {
          entered();
          await barrier;
        }
      },
    },
  );
});
it("canonical parent retirement refuses an append while its actual committed reply is pending", async () => {
  let release!: () => void,
    entered!: () => void,
    armed = false;
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
      const compiler = createAdmittedConfigureEventCompiler(token),
        values = await h.eventsFor(child);
      armed = true;
      const dispatched = compiler.dispatch(values.dispatch);
      const refused = expect(dispatched).rejects.toThrow("C10_SOURCE_STOP");
      try {
        await reached;
        h.core.owner.retire();
        await refused;
      } finally {
        release();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(() => createAdmittedConfigureEventCompiler(token)).toThrow(
        "CONFIGURE_CHANNEL_CONSUMED",
      );
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      expect(
        (
          await child.journal.readAttempt({
            attemptId: child.fresh.result.reservation.attemptId,
          })
        )?.events,
      ).toHaveLength(1);
    },
    {
      afterAppend: async () => {
        if (armed) {
          entered();
          await barrier;
        }
      },
    },
  );
});

it.each(["copy", "proxy", "extra-options", "duplicate", "failed-capture"])(
  "%s cannot replace or remint a private child channel",
  async (scenario) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      let traps = 0;
      const input =
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
      const extra = new Proxy(
        {},
        {
          ownKeys() {
            traps++;
            throw Error("REPLACEMENT_INVOKED");
          },
        },
      );
      if (scenario === "duplicate") createAdmittedConfigureEventCompiler(token);
      const query = h.ctx.runQuery;
      if (scenario === "failed-capture")
        h.ctx.runQuery = async () => {
          throw Error("REPLACED_QUERY");
        };
      const before = vi.mocked(process.hrtime.bigint).mock.calls.length;
      let refused = false;
      try {
        Reflect.apply(
          createAdmittedConfigureEventCompiler,
          undefined,
          scenario === "extra-options" ? [input, extra] : [input],
        );
      } catch {
        refused = true;
      } finally {
        h.ctx.runQuery = query;
      }
      const after = vi.mocked(process.hrtime.bigint).mock.calls.length;
      expect(refused).toBe(true);
      expect(traps).toBe(0);
      if (scenario !== "failed-capture") expect(after - before).toBe(0);
      if (scenario === "copy" || scenario === "proxy")
        expect(createAdmittedConfigureEventCompiler(token).stageChannel).toBe(
          "configure",
        );
      else
        expect(() => createAdmittedConfigureEventCompiler(token)).toThrow(
          "CONFIGURE_CHANNEL_CONSUMED",
        );
    });
  },
);
it("a child-only RPC pointer change refuses before event reflection and permanently closes the channel", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    await h.inAnotherAction(async (ctx) => {
      const child = await h.child({ ctx });
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const compiler = createAdmittedConfigureEventCompiler(token),
        values = await h.eventsFor(child);
      const query = ctx.runQuery;
      ctx.runQuery = async () => {
        throw Error("REPLACED_CHILD_QUERY");
      };
      let traps = 0;
      const hostile = new Proxy(values.dispatch, {
        getPrototypeOf() {
          traps++;
          throw Error("EVENT_REFLECTED");
        },
      });
      try {
        expect(() => h.core.owner.check()).not.toThrow();
        await expect(compiler.dispatch(hostile)).rejects.toThrow(
          "C10_SOURCE_STOP",
        );
        expect(traps).toBe(0);
      } finally {
        ctx.runQuery = query;
      }
      await expect(compiler.dispatch(values.dispatch)).rejects.toThrow(
        "C10_SOURCE_STOP",
      );
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      await expect(
        child.journal.readAttempt({
          attemptId: child.fresh.result.reservation.attemptId,
        }),
      ).rejects.toThrow("CLASS_ACTION_JOURNAL_UNBOUND");
      expect(
        (
          await ctx.runQuery(
            components.betterStripe.renewalOperations.queries.readAttempt,
            {
              operationId: child.created.operationId,
              attemptId: child.fresh.result.reservation.attemptId,
            },
          )
        )?.events,
      ).toHaveLength(0);
    });
  });
});
it.each(["true", "promise", "then-getter", "proxy-guard"])(
  "the guarded kernel rejects %s without replacing its canonical Owner",
  async (scenario) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const child = await h.child();
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const lineage = readConfigureLineage(token);
      let traps = 0;
      const result =
        scenario === "promise"
          ? Promise.resolve(undefined)
          : scenario === "then-getter"
            ? Object.defineProperty({}, "then", {
                get() {
                  traps++;
                  throw Error("THEN_INVOKED");
                },
              })
            : true;
      const guard =
        scenario === "proxy-guard"
          ? new Proxy(() => undefined, {
              apply() {
                traps++;
                throw Error("GUARD_INVOKED");
              },
            })
          : () => result;
      expect(() =>
        createGuardedInitialStageChannel(
          lineage.parentToken,
          { timeoutMs: 100, send: () => Promise.resolve() },
          guard,
        ),
      ).toThrow("C10_SOURCE_STOP");
      expect(traps).toBe(0);
      expect(() => h.core.owner.check()).not.toThrow();
      expect(admissionControls.legacy).toBe(0);
    });
  },
);
it("a child-only binding change during an actual committed append cannot receive a channel ACK", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    await h.inAnotherAction(async (ctx) => {
      let release!: () => void,
        entered!: () => void,
        armed = false;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const mutate = ctx.runMutation;
      ctx.runMutation = async (ref, ...args) => {
        const result = await mutate(ref, ...args);
        if (
          armed &&
          getFunctionAddress(ref).reference?.endsWith("/appendStageEvent")
        ) {
          entered();
          await barrier;
        }
        return result;
      };
      const child = await h.child({ ctx });
      const token = await h.core.admitConfigure(
        child.fresh.call,
        child.journal,
      );
      const compiler = createAdmittedConfigureEventCompiler(token),
        values = await h.eventsFor(child);
      armed = true;
      const pending = compiler.dispatch(values.dispatch);
      const refused = expect(pending).rejects.toThrow("C10_SOURCE_STOP");
      const query = ctx.runQuery;
      try {
        await reached;
        ctx.runQuery = async () => {
          throw Error("CHANGED_CHILD_QUERY");
        };
        expect(() => h.core.owner.check()).not.toThrow();
      } finally {
        release();
      }
      await refused;
      ctx.runQuery = query;
      await expect(compiler.response(values.response)).rejects.toThrow(
        "C10_SOURCE_STOP",
      );
      if (child.fresh.result.disposition !== "acquired")
        throw Error("INVALID_FIXTURE_CAS");
      await expect(
        child.journal.readAttempt({
          attemptId: child.fresh.result.reservation.attemptId,
        }),
      ).rejects.toThrow("CLASS_ACTION_JOURNAL_UNBOUND");
      expect(
        (
          await ctx.runQuery(
            components.betterStripe.renewalOperations.queries.readAttempt,
            {
              operationId: child.created.operationId,
              attemptId: child.fresh.result.reservation.attemptId,
            },
          )
        )?.events,
      ).toHaveLength(1);
    });
  });
});

it("another child's valid dispatch cannot replace the captured configure source", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const one = await h.child(),
      two = await h.child();
    const a = await h.core.admitConfigure(one.fresh.call, one.journal),
      b = await h.core.admitConfigure(two.fresh.call, two.journal);
    const first = createAdmittedConfigureEventCompiler(a),
      second = createAdmittedConfigureEventCompiler(b);
    const av = await h.eventsFor(one),
      bv = await h.eventsFor(two);
    await expect(first.dispatch(bv.dispatch)).rejects.toThrow(
      "C10_SOURCE_STOP",
    );
    await expect(first.dispatch(av.dispatch)).rejects.toThrow(
      "C10_SOURCE_STOP",
    );
    await second.dispatch(bv.dispatch);
    if (
      one.fresh.result.disposition !== "acquired" ||
      two.fresh.result.disposition !== "acquired"
    )
      throw Error("INVALID_FIXTURE_CAS");
    expect(
      (
        await one.journal.readAttempt({
          attemptId: one.fresh.result.reservation.attemptId,
        })
      )?.events,
    ).toHaveLength(0);
    expect(
      (
        await two.journal.readAttempt({
          attemptId: two.fresh.result.reservation.attemptId,
        })
      )?.events,
    ).toHaveLength(1);
    expect(() => h.core.owner.check()).not.toThrow();
  });
});
it("another child's complete C9 cannot become receipt3 or alter retained acknowledgement DATA", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const one = await h.child(),
      two = await h.child();
    const token = await h.core.admitConfigure(two.fresh.call, two.journal);
    const compiler = createAdmittedConfigureEventCompiler(token),
      av = await h.eventsFor(one),
      bv = await h.eventsFor(two);
    await compiler.dispatch(bv.dispatch);
    await compiler.response(bv.response);
    if (two.fresh.result.disposition !== "acquired")
      throw Error("INVALID_FIXTURE_CAS");
    const retained = await two.journal.retainProviderAcknowledgement({
      attemptId: two.fresh.result.reservation.attemptId,
      expectedSequence: 2,
      receiptJSON: JSON.stringify(renewalSnapshot(bv.receipt)),
    });
    await expect(
      compiler.receipt({ ...bv.receiptEvent, receipt: av.receipt }),
    ).rejects.toThrow("C10_SOURCE_STOP");
    const known = await two.journal.readProviderAcknowledgement();
    expect(known?.retention).toEqual(retained);
    expect(known?.receiptJSON).toBe(
      JSON.stringify(renewalSnapshot(bv.receipt)),
    );
    expect(
      (
        await two.journal.readAttempt({
          attemptId: two.fresh.result.reservation.attemptId,
        })
      )?.events,
    ).toHaveLength(2);
  });
});
