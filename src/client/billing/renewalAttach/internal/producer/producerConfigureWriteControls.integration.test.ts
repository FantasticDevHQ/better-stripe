import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureAdmissionFixture,
  admissionControls,
  configureAdmissionCase,
  prepareAdmittedConfigure,
} from "../test-fixtures/producerConfigureAdmission.js";
import { captureAdmittedConfigurePreflight } from "./configurePreflight.js";
import {
  captureAdmittedConfigureWrite,
  readAdmittedConfigureAcknowledgement,
} from "./configureWrite.js";
import { object } from "./configureJournalData.js";

type Harness = Parameters<Parameters<typeof configureAdmissionFixture>[0]>[0];
async function prepare(h: Harness, preflight = true) {
  await h.complete();
  const child = await h.child();
  const token = await h.core.admitConfigure(child.fresh.call, child.journal);
  const current = h.configureReads(child);
  if (admissionControls.preflight.length === 0)
    admissionControls.preflight.push({
      originalEntry: admissionControls.entries[0],
      coversPreflight: () => true,
    });
  if (admissionControls.write.length === 0)
    admissionControls.write.push({
      originalEntry: admissionControls.entries[0],
      coversConfigure: () => true,
    });
  if (preflight) await captureAdmittedConfigurePreflight(token).invoke();
  return { child, token, current };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function posts(h: Harness) {
  return h.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.path.startsWith("/v1/subscription_schedules/"),
  );
}

it.each([
  "no-preflight",
  "empty",
  "foreign",
  "ambiguous",
  "copy",
  "proxy",
  "extra",
])("refuses %s write custody without provider reads", async (scenario) => {
  await configureAdmissionFixture(async (h) => {
    const { token } = await prepare(h, scenario !== "no-preflight");
    if (scenario === "empty") admissionControls.write.splice(0);
    if (scenario === "foreign") admissionControls.write[0].originalEntry = {};
    if (scenario === "ambiguous")
      admissionControls.write.push({ ...admissionControls.write[0] });
    let traps = 0;
    const copied =
      scenario === "copy"
        ? { ...token }
        : scenario === "proxy"
          ? new Proxy(token, {
              get() {
                traps++;
                throw Error("PROXY_TRAP");
              },
            })
          : token;
    const before = h.calls.length;
    expect(() =>
      scenario === "extra"
        ? Reflect.apply(captureAdmittedConfigureWrite, undefined, [token, {}])
        : captureAdmittedConfigureWrite(copied),
    ).toThrow();
    expect(h.calls).toHaveLength(before);
    expect(posts(h)).toHaveLength(0);
    expect(traps).toBe(0);
    expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
  });
});
it("invalid invoke arguments spend the actor without a POST or second frame", async () => {
  await configureAdmissionFixture(async (h) => {
    const { token } = await prepare(h),
      actor = captureAdmittedConfigureWrite(token),
      before = h.calls.length;
    await expect(Reflect.apply(actor.invoke, actor, [{}])).rejects.toThrow();
    await expect(actor.invoke()).rejects.toThrow();
    expect(() => captureAdmittedConfigureWrite(token)).toThrow();
    expect(h.calls).toHaveLength(before);
  });
});
it.each([
  "subscription",
  "schedule",
  "predicate",
  "entry-pointer",
  "preflight-pointer",
])("changed %s refuses before POST", async (scenario) => {
  await configureAdmissionFixture(async (h) => {
    const { token, current } = await prepare(h),
      actor = captureAdmittedConfigureWrite(token);
    if (scenario === "subscription")
      Reflect.set(current.subscription, "metadata", { changed: true });
    if (scenario === "schedule") current.schedule.metadata = { changed: true };
    if (scenario === "predicate")
      admissionControls.write[0].coversConfigure = () => false;
    if (scenario === "entry-pointer") admissionControls.write.splice(0);
    if (scenario === "preflight-pointer")
      admissionControls.preflight[0].coversPreflight = () => true;
    try {
      await actor.invoke();
    } catch {
      /* Closed source metadata may reject. */
    }
    expect(posts(h)).toHaveLength(0);
    expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
    await expect(actor.invoke()).rejects.toThrow();
  });
});
for (const phase of ["dispatch", "retention", "receipt"] as const) {
  const entered = deferred(),
    released = deferred();
  let armed = false,
    appended = 0;
  configureAdmissionCase(
    "pending " + phase + " reply cannot return actual configure ACK",
    prepareAdmittedConfigure,
    async (h, { token, child }) => {
      armed = true;
      const actor = captureAdmittedConfigureWrite(token),
        pending = actor.invoke();
      try {
        expect(
          await Promise.race([
            entered.promise.then(() => true),
            pending.then(
              () => false,
              () => false,
            ),
          ]),
        ).toBe(true);
        expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
        await expect(actor.invoke()).rejects.toThrow();
        expect(posts(h)).toHaveLength(phase === "dispatch" ? 0 : 1);
        if (phase !== "dispatch")
          expect(
            await child.journal.readProviderAcknowledgement(),
          ).not.toBeNull();
      } finally {
        released.resolve();
      }
      const output = await pending;
      expect(object(output).status).toBe("configure_acknowledged");
      expect(
        readAdmittedConfigureAcknowledgement(token).output === output,
      ).toBe(true);
    },
    {
      afterAppend: async () => {
        if (
          armed &&
          ++appended === (phase === "dispatch" ? 1 : 3) &&
          phase !== "retention"
        ) {
          entered.resolve();
          await released.promise;
        }
      },
      afterRetain: async () => {
        if (armed && phase === "retention") {
          entered.resolve();
          await released.promise;
        }
      },
    },
  );
}
it("retention rejection after commit keeps C9 but returns no ACK or second POST", async () => {
  let armed = false;
  await configureAdmissionFixture(
    async (h) => {
      const { token, child } = await prepare(h);
      armed = true;
      const actor = captureAdmittedConfigureWrite(token);
      expect(object(await actor.invoke()).status).toBe("configure_unknown");
      expect(await child.journal.readProviderAcknowledgement()).not.toBeNull();
      expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
      await expect(actor.invoke()).rejects.toThrow();
      expect(posts(h)).toHaveLength(1);
    },
    {
      afterRetain: async () => {
        if (armed) throw Error("CONTROLLED_RETENTION_REPLY_REJECTION");
      },
    },
  );
});
it("parent retirement during POST returns unknown and late fulfillment cannot publish ACK", async () => {
  const entered = deferred(),
    released = deferred();
  let armed = false;
  await configureAdmissionFixture(
    async (h) => {
      const { token, child } = await prepare(h);
      armed = true;
      const actor = captureAdmittedConfigureWrite(token),
        pending = actor.invoke();
      try {
        expect(
          await Promise.race([
            entered.promise.then(() => true),
            pending.then(
              () => false,
              () => false,
            ),
          ]),
        ).toBe(true);
        h.core.owner.retire();
        expect(object(await pending).status).toBe("configure_unknown");
        expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
      } finally {
        released.resolve();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(await child.journal.readProviderAcknowledgement()).toBeNull();
      expect(posts(h)).toHaveLength(1);
      await expect(actor.invoke()).rejects.toThrow();
    },
    {
      beforeFetch: async (_path, method) => {
        if (armed && method === "POST") {
          armed = false;
          entered.resolve();
          await released.promise;
        }
      },
    },
  );
});
it("unsafe fulfilled POST stays unknown without response event or returned ACK", async () => {
  await configureAdmissionFixture(async (h) => {
    const { token, child } = await prepare(h);
    Reflect.set(h.baseline.schedule, "metadata", {
      unsafe: "Bearer synthetic-configure-write-control",
    });
    const output = await captureAdmittedConfigureWrite(token).invoke();
    expect(object(output).status).toBe("configure_unknown");
    expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
    expect(await child.journal.readProviderAcknowledgement()).toBeNull();
    expect(posts(h)).toHaveLength(1);
  });
});

it.each(["GET", "POST"])(
  "an actual %s rejection carries bounded failure and never retries",
  async (verb) => {
    let armed = false,
      attempts = 0;
    await configureAdmissionFixture(
      async (h) => {
        const { token, child } = await prepare(h);
        armed = true;
        const actor = captureAdmittedConfigureWrite(token);
        let actual: unknown;
        try {
          await actor.invoke();
        } catch (error) {
          actual = error;
        }
        expect(actual).toBeInstanceOf(Error);
        expect(object(Reflect.get(actual as Error, "failure")).phase).toBe(
          verb === "GET" ? "read" : "post",
        );
        expect(attempts).toBe(1);
        expect(await child.journal.readProviderAcknowledgement()).toBeNull();
        expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
        await expect(actor.invoke()).rejects.toThrow();
      },
      {
        beforeFetch: async (_path, method) => {
          if (armed && method === verb) {
            attempts++;
            throw Error("CONTROLLED_PROVIDER_REJECTION");
          }
        },
      },
    );
  },
);
it("a returned ACK reader preserves output identity and closes after observed Source pointer drift", async () => {
  await configureAdmissionFixture(async (h) => {
    const { token } = await prepare(h);
    const output = await captureAdmittedConfigureWrite(token).invoke();
    const view = readAdmittedConfigureAcknowledgement(token);
    expect(view.output === output).toBe(true);
    expect(view.receipt === object(output).receipt).toBe(true);
    expect(() => readAdmittedConfigureAcknowledgement({ ...token })).toThrow();
    expect(() =>
      Reflect.apply(readAdmittedConfigureAcknowledgement, undefined, [
        token,
        structuredClone(output),
      ]),
    ).toThrow();
    const covers = admissionControls.write[0].coversConfigure;
    admissionControls.write[0].coversConfigure = () => true;
    expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
    admissionControls.write[0].coversConfigure = covers;
    expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
    expect(posts(h)).toHaveLength(1);
  });
});
it("a genuine second Action context retains the original configure attempt custody", async () => {
  await configureAdmissionFixture(async (h) => {
    const { token } = await prepare(h),
      actor = captureAdmittedConfigureWrite(token);
    await h.inAnotherAction(async () => {
      const output = await actor.invoke();
      expect(object(output).status).toBe("configure_acknowledged");
      expect(
        readAdmittedConfigureAcknowledgement(token).output === output,
      ).toBe(true);
    });
    expect(posts(h)).toHaveLength(1);
    expect(admissionControls.legacy).toBe(0);
  });
});

it.each(["event-payload-alias", "changed-id", "extra-field"])(
  "refuses %s in the final retention readback",
  async (scenario) => {
    let childId = "",
      eventPayload = "",
      forged = false;
    await configureAdmissionFixture(
      async (h) => {
        const { token, child } = await prepare(h);
        childId = child.created.operationId;
        const output = await captureAdmittedConfigureWrite(token).invoke();
        expect(forged).toBe(true);
        expect(object(output).status).toBe("configure_unknown");
        expect(() => readAdmittedConfigureAcknowledgement(token)).toThrow();
        expect(posts(h)).toHaveLength(1);
      },
      {
        afterQuery: async (reply, reference, args) => {
          if (!reply || object(args).operationId !== childId) return;
          const own = object(reply);
          if (
            reference.endsWith("/readAttempt") &&
            Array.isArray(own.events) &&
            own.events.length === 3
          ) {
            const payload = object(own.events[2]).payloadId;
            if (typeof payload === "string") eventPayload = payload;
          }
          if (
            reference.endsWith("/readProviderAcknowledgement") &&
            eventPayload &&
            own.retention &&
            typeof own.retention === "object"
          ) {
            Reflect.set(
              own.retention,
              scenario === "extra-field" ? "extra" : "receiptPayloadId",
              scenario === "event-payload-alias"
                ? eventPayload
                : "controlled-changed-payload",
            );
            forged = true;
          }
        },
      },
    );
  },
);

describe("concurrent admitted children", () => {
  let pending: Promise<void>,
    start: ReturnType<typeof deferred>,
    postsReady: ReturnType<typeof deferred>,
    releasePosts: ReturnType<typeof deferred>,
    retainedReady: ReturnType<typeof deferred>,
    releaseRetained: ReturnType<typeof deferred>,
    run = false,
    armed = false,
    postCount = 0,
    retainedCount = 0;
  const stage = (ready: ReturnType<typeof deferred>) =>
    Promise.race([
      ready.promise,
      pending.then(() => {
        throw Error("FIXTURE_SETTLED_BEFORE_STAGE");
      }),
    ]);
  beforeEach(async () => {
    run = false;
    armed = false;
    postCount = 0;
    retainedCount = 0;
    start = deferred();
    postsReady = deferred();
    releasePosts = deferred();
    retainedReady = deferred();
    releaseRetained = deferred();
    let ready!: () => void, failed!: (error: unknown) => void;
    const prepared = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    pending = configureAdmissionFixture(
      async (h) => {
        const first = await prepare(h);
        const child = await h.child();
        const token = await h.core.admitConfigure(
          child.fresh.call,
          child.journal,
        );
        h.configureReads(child);
        await captureAdmittedConfigurePreflight(token).invoke();
        ready();
        await start.promise;
        if (!run) return;
        armed = true;
        const actors = [
          captureAdmittedConfigureWrite(first.token),
          captureAdmittedConfigureWrite(token),
        ];
        const outputs = await Promise.all(
          actors.map((actor) => actor.invoke()),
        );
        expect(outputs.map((output) => object(output).status)).toEqual([
          "configure_acknowledged",
          "configure_acknowledged",
        ]);
        expect(outputs[0] === outputs[1]).toBe(false);
        expect(
          readAdmittedConfigureAcknowledgement(first.token).output ===
            outputs[0],
        ).toBe(true);
        expect(
          readAdmittedConfigureAcknowledgement(token).output === outputs[1],
        ).toBe(true);
        expect(
          posts(h)
            .map((call) => call.idempotencyKey)
            .sort(),
        ).toEqual(
          [
            first.child.record.configureRecord.request.key,
            child.record.configureRecord.request.key,
          ].sort(),
        );
        const retained = await Promise.all([
          first.child.journal.readProviderAcknowledgement(),
          child.journal.readProviderAcknowledgement(),
        ]);
        expect(retained.every((value) => value !== null)).toBe(true);
        expect(retained[0]!.receiptJSON === retained[1]!.receiptJSON).toBe(
          false,
        );
      },
      {
        beforeFetch: async (path, method) => {
          if (
            armed &&
            method === "POST" &&
            path.startsWith("/v1/subscription_schedules/")
          ) {
            if (++postCount === 2) postsReady.resolve();
            await releasePosts.promise;
          }
        },
        afterRetain: async () => {
          if (armed) {
            if (++retainedCount === 2) retainedReady.resolve();
            await releaseRetained.promise;
          }
        },
      },
    );
    void pending.catch(failed);
    await prepared;
  });
  beforeEach(async () => {
    run = true;
    start.resolve();
    await stage(postsReady);
  });
  beforeEach(async () => {
    releasePosts.resolve();
    await stage(retainedReady);
  });
  afterEach(async () => {
    start?.resolve();
    releasePosts?.resolve();
    releaseRetained?.resolve();
    await pending?.catch(() => {});
  });
  it("concurrent children retain separate POST keys, journals and returned outputs", async () => {
    expect(postCount).toBe(2);
    expect(retainedCount).toBe(2);
    releaseRetained.resolve();
    await pending;
  });
});

describe("independent SDK root lifetime", () => {
  let prior: object;
  beforeEach(async () => {
    await configureAdmissionFixture(async (h) => {
      const { token } = await prepare(h);
      prior = token;
      expect(
        object(await captureAdmittedConfigureWrite(token).invoke()).status,
      ).toBe("configure_acknowledged");
    });
  });
  it("retiring one SDK root cannot close a later independent root", async () => {
    await configureAdmissionFixture(async (h) => {
      const { token } = await prepare(h);
      expect(() => readAdmittedConfigureAcknowledgement(prior)).toThrow();
      const output = await captureAdmittedConfigureWrite(token).invoke();
      expect(object(output).status).toBe("configure_acknowledged");
      expect(
        readAdmittedConfigureAcknowledgement(token).output === output,
      ).toBe(true);
      expect(() => readAdmittedConfigureAcknowledgement(prior)).toThrow();
    });
  });
});
