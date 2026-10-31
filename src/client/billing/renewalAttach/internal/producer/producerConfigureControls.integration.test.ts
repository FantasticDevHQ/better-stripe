import { expect, it } from "vitest";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";
import { data } from "../test-fixtures/attachScenarioBarriers.js";
import { BetterStripe } from "../../../../index.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import {
  configureAdmissionFixture,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";

it.each([
  "copy-call",
  "copy-journal",
  "foreign-journal",
  "proxy-call",
  "proxy-journal",
  "extra-argument",
  "wrong-root",
  "spent",
  "legacy-child",
  "attach-child",
])(
  "refuses %s custody without another selector or provider request",
  async (scenario) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const parent =
        h.fresh.result.disposition === "acquired"
          ? JSON.parse(h.fresh.result.reservation.recordJSON)
          : null;
      const child = await h.child(
        scenario === "legacy-child"
          ? {
              change: (raw) => {
                raw.schemaVersion = 1;
                raw.basis = JSON.parse(h.core.basisJSON);
                delete raw.timingPolicy;
              },
            }
          : scenario === "attach-child"
            ? {
                stage: "attach",
                change: (raw) => {
                  Object.assign(raw, {
                    stage: "attach",
                    attachRequest: h.source.attachRequest,
                    requestBinding: parent.requestBinding,
                    dispatch: parent.dispatch,
                    timingPolicy: parent.timingPolicy,
                  });
                },
              }
            : scenario === "wrong-root"
              ? {
                  sdk: new BetterStripe(components.betterStripe, {
                    STRIPE_SECRET_KEY: "sk_test_invalid_owner_core",
                  }),
                }
              : {},
      );
      let traps = 0;
      const call =
        scenario === "copy-call"
          ? {}
          : scenario === "proxy-call"
            ? new Proxy(child.fresh.call!, {
                get() {
                  traps++;
                  throw Error("GET_TRAP");
                },
              })
            : child.fresh.call;
      const other = scenario === "foreign-journal" ? await h.child() : null;
      const journal = other
        ? other.journal
        : scenario === "copy-journal"
          ? { ...child.journal }
          : scenario === "proxy-journal"
            ? new Proxy(child.journal, {
                get() {
                  traps++;
                  throw Error("GET_TRAP");
                },
              })
            : child.journal;
      const args: unknown[] = [call, journal];
      if (scenario === "extra-argument")
        args.push(h.core.attachAcknowledgement().receipt);
      if (scenario === "spent")
        await h.core.admitConfigure(child.fresh.call, child.journal);
      const selectors = admissionControls.selectors;
      const calls = h.calls.length;
      await expect(
        Reflect.apply(h.core.admitConfigure, h.core, args),
      ).rejects.toThrow();
      expect(traps).toBe(0);
      expect(admissionControls.selectors).toBe(selectors);
      expect(h.calls).toHaveLength(calls);
      if (["copy-call", "proxy-call"].includes(scenario))
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).resolves.toHaveProperty("operationalAuthority", false);
      else
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
    });
  },
);
it("existing CAS replies supply no fresh child admission", async () => {
  await configureAdmissionFixture(async (h) => {
    await h.complete();
    const child = await h.child();
    const existing = await child.journal.reserveFreshAttempt(child.reserveArgs);
    expect(existing.result.disposition).toBe("existing");
    expect(existing.call).toBeNull();
    await expect(
      h.core.admitConfigure(existing.call, child.journal),
    ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
    await expect(
      h.core.admitConfigure(child.fresh.call, child.journal),
    ).resolves.toHaveProperty("owner", h.core.owner);
  });
});
it.each(["retired", "predicate", "binding-pointers"])(
  "refuses changed parent %s custody and spends the child handle",
  async (scenario) => {
    await configureAdmissionFixture(async (h) => {
      await h.complete();
      const child = await h.child();
      if (scenario === "retired") h.core.owner.retire();
      if (scenario === "predicate")
        admissionControls.entries[0].coversFresh = () => true;
      if (scenario === "binding-pointers")
        h.ctx.runQuery = async () => {
          throw Error("REPLACED_RPC");
        };
      await expect(
        h.core.admitConfigure(child.fresh.call, child.journal),
      ).rejects.toThrow();
      await expect(
        h.core.admitConfigure(child.fresh.call, child.journal),
      ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
    });
  },
);
it.each(["retire", "predicate", "contradictory-reply"])(
  "does not return admission when %s occurs during child binding",
  async (scenario) => {
    let afterBind: ((reply: unknown) => Promise<void>) | undefined;
    await configureAdmissionFixture(
      async (h) => {
        await h.complete();
        const child = await h.child();
        afterBind = async (reply) => {
          if (scenario === "retire") h.core.owner.retire();
          if (scenario === "predicate")
            admissionControls.entries[0].coversRetained = () => true;
          if (scenario === "contradictory-reply")
            Object.assign(reply as object, {
              operationId: "foreign-operation",
            });
        };
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow();
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
      },
      {
        afterBind: async (reply) => {
          await afterBind?.(reply);
        },
      },
    );
  },
);
it("retirement rejects promptly while the actual committed basis reply remains pending", async () => {
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let block = false;
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      block = true;
      const admitted = h.core.admitConfigure(child.fresh.call, child.journal);
      const refusal = expect(admitted).rejects.toThrow("INITIAL_OWNER_STOP");
      await committed;
      const loaded = await child.journal.loadAuthorizedOperation();
      expect(
        loaded && "initialBasis" in loaded ? loaded.initialBasis : null,
      ).not.toBeNull();
      h.core.owner.retire();
      await refusal;
      release();
      await expect(
        h.core.admitConfigure(child.fresh.call, child.journal),
      ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
    },
    {
      afterBind: async () => {
        if (block) {
          entered();
          await pending;
        }
      },
    },
  );
});
it("published receipt DATA cannot replace actual returned parent ACK custody", async () => {
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let appended = 0;
  await configureAdmissionFixture(
    async (h) => {
      const attachment = h.complete();
      await committed;
      const child = await h.child();
      expect(() => h.core.attachAcknowledgement()).toThrow(
        "ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE",
      );
      await expect(
        h.core.admitConfigure(child.fresh.call, child.journal),
      ).rejects.toThrow("ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE");
      release();
      await attachment;
      await expect(
        h.core.admitConfigure(child.fresh.call, child.journal),
      ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
      const next = await h.child();
      await expect(
        h.core.admitConfigure(next.fresh.call, next.journal),
      ).resolves.toHaveProperty("owner", h.core.owner);
    },
    {
      afterAppend: async () => {
        if (++appended === 3) {
          entered();
          await pending;
        }
      },
    },
  );
});

it.each([
  "parent-load",
  "child-load",
  "child-load-after-bind",
  "parent-history",
  "child-history",
  "parent-event",
  "parent-ACK",
  "parent-array-getter",
  "parent-array-proxy",
])(
  "refuses malformed %s RPC DATA without invoking caller traps or returning admission",
  async (scenario) => {
    let armed = false,
      changed = false,
      bound = false,
      traps = 0;
    let childId = "";
    await configureAdmissionFixture(
      async (h) => {
        await h.complete();
        const child = await h.child();
        childId = child.created.operationId;
        armed = true;
        const calls = h.calls.length,
          selectors = admissionControls.selectors;
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow();
        expect(changed).toBe(true);
        expect(traps).toBe(0);
        expect(h.calls).toHaveLength(calls);
        expect(admissionControls.selectors).toBe(selectors);
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
      },
      {
        afterBind: async () => {
          if (armed) bound = true;
        },
        afterQuery: async (reply, reference, args) => {
          if (!armed || changed || !reply) return;
          const input = data(args),
            value = data(reply);
          const child = input.operationId === childId;
          if (
            reference.endsWith("/loadAuthorizedOperation") &&
            ((scenario === "parent-load" && !child) ||
              (scenario === "child-load" && child) ||
              (scenario === "child-load-after-bind" && child && bound))
          ) {
            value.recordJSON = String(value.recordJSON) + " ";
            changed = true;
          }
          if (
            reference.endsWith("/readAttempt") &&
            !child &&
            [
              "parent-history",
              "parent-array-getter",
              "parent-array-proxy",
            ].includes(scenario)
          ) {
            if (scenario === "parent-history")
              data(value.reservation).key = "foreign-key";
            else {
              const events = value.events;
              if (!Array.isArray(events)) throw Error("INVALID_FIXTURE_EVENTS");
              if (scenario === "parent-array-getter")
                Object.defineProperty(events, "0", {
                  enumerable: true,
                  configurable: true,
                  get() {
                    traps++;
                    throw Error("GETTER_INVOKED");
                  },
                });
              else
                value.events = new Proxy(events, {
                  get() {
                    traps++;
                    throw Error("PROXY_INVOKED");
                  },
                });
            }
            changed = true;
          }
          if (
            reference.endsWith("/readAttempt") &&
            child &&
            scenario === "child-history"
          ) {
            value.future = true;
            changed = true;
          }
          if (
            reference.endsWith("/readStageEvent") &&
            !child &&
            scenario === "parent-event"
          ) {
            value.binding = "foreign-event-binding";
            changed = true;
          }
          if (
            reference.endsWith("/readProviderAcknowledgement") &&
            !child &&
            scenario === "parent-ACK"
          ) {
            data(value.retention).responsePayloadId = "foreign-payload";
            changed = true;
          }
        },
      },
    );
  },
);
it.each(["stage", "basis", "extra-field", "getter", "proxy"])(
  "refuses contradictory %s binding reply after actual commit without promoting DATA",
  async (scenario) => {
    let armed = false,
      traps = 0;
    await configureAdmissionFixture(
      async (h) => {
        await h.complete();
        const child = await h.child();
        armed = true;
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow();
        expect(traps).toBe(0);
        const loaded = await child.journal.loadAuthorizedOperation();
        expect(
          loaded && "initialBasis" in loaded ? loaded.initialBasis : null,
        ).not.toBeNull();
        await expect(
          h.core.admitConfigure(child.fresh.call, child.journal),
        ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
      },
      {
        afterBind: async (reply) => {
          if (!armed) return;
          const value = data(reply),
            basis = data(value.initialBasis);
          if (scenario === "stage") basis.stage = "attach";
          if (scenario === "basis") basis.basisJSON = "{}";
          if (scenario === "extra-field") value.future = true;
          if (scenario === "getter")
            Object.defineProperty(value, "initialBasis", {
              enumerable: true,
              configurable: true,
              get() {
                traps++;
                throw Error("GETTER_INVOKED");
              },
            });
          if (scenario === "proxy")
            value.initialBasis = new Proxy(basis, {
              get() {
                traps++;
                throw Error("PROXY_INVOKED");
              },
            });
        },
      },
    );
  },
);

it("refuses a child event committed while the final no-ACK read is pending", async () => {
  let armed = false,
    bound = false,
    advanced = false,
    childId = "";
  let append!: () => Promise<unknown>;
  await configureAdmissionFixture(
    async (h) => {
      await h.complete();
      const child = await h.child();
      childId = child.created.operationId;
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
      append = () =>
        child.journal.appendStageEvent({
          reservation,
          expectedSequence: 0,
          event: { sequence: 1, binding: event.binding, dataJSON: event.json },
        });
      armed = true;
      let refused = false;
      try {
        await h.core.admitConfigure(child.fresh.call, child.journal);
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
      expect(advanced).toBe(true);
      const history = await child.journal.readAttempt({
        attemptId: reservation.attemptId,
      });
      expect(history?.events).toHaveLength(1);
      await expect(
        h.core.admitConfigure(child.fresh.call, child.journal),
      ).rejects.toThrow("CLASS_JOURNAL_CALL_UNBOUND");
    },
    {
      afterBind: async () => {
        if (armed) bound = true;
      },
      afterQuery: async (reply, ref, args) => {
        if (
          armed &&
          bound &&
          !advanced &&
          ref.endsWith("/readProviderAcknowledgement") &&
          data(args).operationId === childId &&
          reply === null
        ) {
          advanced = true;
          await append();
        }
      },
    },
  );
});

it.each([
  "dispatch-request",
  "response-request",
  "response-body",
  "response-status",
])(
  "refuses hash-consistent but contradictory parent %s DATA",
  async (scenario) => {
    let armed = false,
      childId = "",
      changedManifest = false,
      changedEvent = false;
    let forged: { json: string; binding: string };
    const sequence = scenario === "dispatch-request" ? 1 : 2;
    await configureAdmissionFixture(
      async (h) => {
        await h.complete();
        const child = await h.child();
        childId = child.created.operationId;
        if (h.fresh.result.disposition !== "acquired")
          throw Error("INVALID_FIXTURE_CAS");
        const actual = await h.journal.readStageEvent({
          attemptId: h.fresh.result.reservation.attemptId,
          sequence,
        });
        if (!actual) throw Error("INVALID_FIXTURE_EVENT");
        const modified = JSON.parse(actual.dataJSON);
        if (scenario.endsWith("request")) {
          modified.request.key = "foreign-key";
          modified.request.requestIdentity.key = "foreign-key";
        }
        if (scenario === "response-body")
          modified.body.future = { changed: true };
        if (scenario === "response-status") modified.status = 500;
        forged = await canonicalJournalEvent(
          sequence,
          JSON.stringify(renewalSnapshot(modified)),
        );
        armed = true;
        let refused = false;
        try {
          await h.core.admitConfigure(child.fresh.call, child.journal);
        } catch {
          refused = true;
        }
        expect(refused).toBe(true);
        expect(changedManifest && changedEvent).toBe(true);
      },
      {
        afterQuery: async (reply, reference, args) => {
          if (!armed || !reply || data(args).operationId === childId) return;
          if (reference.endsWith("/readAttempt")) {
            const events = data(reply).events;
            if (!Array.isArray(events)) throw Error("INVALID_FIXTURE_MANIFEST");
            data(events[sequence - 1]).binding = forged.binding;
            changedManifest = true;
          }
          if (
            reference.endsWith("/readStageEvent") &&
            data(args).sequence === sequence
          ) {
            const value = data(reply);
            value.binding = forged.binding;
            value.dataJSON = forged.json;
            changedEvent = true;
          }
        },
      },
    );
  },
);
