import { expect, vi } from "vitest";
import {
  configureAdmissionCase,
  prepareAdmittedConfigure,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  captureAdmittedConfigureWrite,
  readAdmittedConfigureAcknowledgement,
} from "./configureWrite.js";
import { captureAdmittedConfigureRecovery } from "./configureRecovery.js";
import { readOriginalConfigureAttempt } from "./configureAttemptAuthority.js";
import { object } from "./configureJournalData.js";
import * as retention from "../configure/replay.js";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";

type Harness = Parameters<typeof prepareAdmittedConfigure>[0];
type State = Awaited<ReturnType<typeof prepareAdmittedConfigure>>;
type Options = Parameters<typeof configureAdmissionCase>[3];
function unknownCase(
  name: string,
  verify: (h: Harness, state: State) => Promise<void>,
  options: Options = {},
) {
  let reject = false;
  configureAdmissionCase(
    name,
    async (h) => {
      const state = await prepareAdmittedConfigure(h);
      reject = true;
      await expect(
        captureAdmittedConfigureWrite(state.token).invoke(),
      ).rejects.toThrow("OWNED_CONFIGURE_PROVIDER_REJECTED");
      return state;
    },
    verify,
    {
      ...options,
      beforeFetch: async (path, method) => {
        if (
          reject &&
          method === "POST" &&
          path.startsWith("/v1/subscription_schedules/")
        ) {
          reject = false;
          throw Error("CONTROLLED_UNKNOWN_POST");
        }
        await options.beforeFetch?.(path, method);
      },
    },
  );
}
function posts(h: Harness, state: State) {
  return h.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.path === state.child.record.configureRecord.request.path,
  );
}
for (const scenario of [
  "copy",
  "proxy",
  "extra-capture",
  "extra-invoke",
  "already-reserved",
] as const) {
  unknownCase(
    "refuses " + scenario + " recovery without another provider call",
    async (h, state) => {
      const before = h.calls.length;
      let traps = 0;
      if (scenario === "copy" || scenario === "proxy") {
        const value =
          scenario === "copy"
            ? { ...state.token }
            : new Proxy(state.token, {
                get() {
                  traps++;
                  throw Error("PROXY_TRAP");
                },
              });
        expect(() => captureAdmittedConfigureRecovery(value)).toThrow();
      } else if (scenario === "extra-capture") {
        expect(() =>
          Reflect.apply(captureAdmittedConfigureRecovery, undefined, [
            state.token,
            {},
          ]),
        ).toThrow();
        expect(() => captureAdmittedConfigureRecovery(state.token)).toThrow();
      } else {
        const actor = captureAdmittedConfigureRecovery(state.token);
        if (scenario === "already-reserved")
          expect(() => captureAdmittedConfigureRecovery(state.token)).toThrow();
        else {
          await expect(
            Reflect.apply(actor.invoke, actor, [{}]),
          ).rejects.toThrow();
          await expect(actor.invoke()).rejects.toThrow();
        }
      }
      expect(h.calls).toHaveLength(before);
      expect(traps).toBe(0);
      expect(() => readAdmittedConfigureAcknowledgement(state.token)).toThrow();
    },
  );
}
for (const scenario of [
  "source-pointer",
  "preflight-pointer",
  "schedule-drift",
  "subscription-drift",
  "retention-expired",
  "retention-before-post",
] as const) {
  unknownCase(
    "refuses " + scenario + " before replay POST",
    async (h, state) => {
      const actor = captureAdmittedConfigureRecovery(state.token);
      if (scenario === "source-pointer")
        admissionControls.write[0].coversConfigure = () => true;
      if (scenario === "preflight-pointer")
        admissionControls.preflight[0].coversPreflight = () => true;
      if (scenario === "schedule-drift")
        state.current.schedule.metadata = { changed: true };
      if (scenario === "subscription-drift")
        Reflect.set(state.current.subscription, "metadata", { changed: true });
      if (scenario === "retention-expired")
        vi.spyOn(retention, "withinConfigureRetention").mockReturnValue(false);
      if (scenario === "retention-before-post")
        vi.spyOn(retention, "withinConfigureRetention")
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValue(false);
      expect(object(await actor.invoke()).status).toBe(
        scenario === "subscription-drift"
          ? "not_dispatched"
          : "configure_unknown",
      );
      expect(posts(h, state)).toHaveLength(1);
      expect(() => readAdmittedConfigureAcknowledgement(state.token)).toThrow();
      await expect(actor.invoke()).rejects.toThrow();
    },
  );
}
unknownCase(
  "journal response DATA cannot recreate missing owned response custody",
  async (h, state) => {
    if (state.child.fresh.result.disposition !== "acquired")
      throw Error("INVALID_FIXTURE_CAS");
    const event = await canonicalJournalEvent(
      2,
      JSON.stringify(
        renewalSnapshot({
          event: "response",
          stage: "configure",
          request: state.child.record.configureRecord.request,
          body: h.baseline.schedule,
          transport: { status: 200, requestId: "req_host_data_only" },
        }),
      ),
    );
    await state.child.journal.appendStageEvent({
      reservation: state.child.fresh.result.reservation,
      expectedSequence: 1,
      event: { sequence: 2, binding: event.binding, dataJSON: event.json },
    });
    const before = h.calls.length;
    expect(
      object(await captureAdmittedConfigureRecovery(state.token).invoke())
        .status,
    ).toBe("configure_unknown");
    expect(h.calls).toHaveLength(before);
    expect(() => readAdmittedConfigureAcknowledgement(state.token)).toThrow();
  },
);
for (const mode of [
  "response-before",
  "response-after",
  "receipt-before",
  "receipt-after",
  "retention-after",
] as const) {
  let armed = false,
    count = 0;
  configureAdmissionCase(
    "no-POST completion after " + mode + " fault",
    async (h) => {
      const state = await prepareAdmittedConfigure(h);
      armed = true;
      count = 0;
      expect(
        object(await captureAdmittedConfigureWrite(state.token).invoke())
          .status,
      ).toBe("configure_unknown");
      armed = false;
      return state;
    },
    async (h, state) => {
      const before = h.calls.length;
      const output = await captureAdmittedConfigureRecovery(
        state.token,
      ).invoke();
      expect(object(output).status).toBe("configure_acknowledged");
      expect(h.calls).toHaveLength(before);
      const view = readAdmittedConfigureAcknowledgement(state.token);
      expect(view.output === output).toBe(true);
      expect(view.receipt === object(output).receipt).toBe(true);
      expect(view.rawReceipt === object(output).rawReceipt).toBe(true);
      expect(
        await state.child.journal.readProviderAcknowledgement(),
      ).not.toBeNull();
      expect(posts(h, state)).toHaveLength(1);
    },
    {
      beforeAppend: async () => {
        if (
          armed &&
          mode.endsWith("-before") &&
          ++count === (mode.startsWith("response") ? 2 : 3)
        )
          throw Error("CONTROLLED_BEFORE_APPEND");
      },
      afterAppend: async () => {
        if (
          armed &&
          mode.endsWith("-after") &&
          mode !== "retention-after" &&
          ++count === (mode.startsWith("response") ? 2 : 3)
        )
          throw Error("CONTROLLED_AFTER_APPEND");
      },
      afterRetain: async () => {
        if (armed && mode === "retention-after")
          throw Error("CONTROLLED_RETAINED_REPLY_REJECTION");
      },
    },
  );
}
let safeFault = false,
  safeCount = 0;
configureAdmissionCase(
  "FULFILLED_SAFE without owned response or C9 refuses replay",
  async (h) => {
    const state = await prepareAdmittedConfigure(h);
    safeFault = true;
    safeCount = 0;
    expect(
      object(await captureAdmittedConfigureWrite(state.token).invoke()).status,
    ).toBe("configure_unknown");
    const attempt = readOriginalConfigureAttempt(state.token);
    attempt.response = null;
    attempt.receipt = null;
    attempt.rawReceipt = null;
    return state;
  },
  async (h, state) => {
    const before = h.calls.length;
    expect(() => captureAdmittedConfigureRecovery(state.token)).toThrow();
    expect(h.calls).toHaveLength(before);
    expect(posts(h, state)).toHaveLength(1);
  },
  {
    beforeAppend: async () => {
      if (safeFault && ++safeCount === 2) {
        safeFault = false;
        throw Error("CONTROLLED_RESPONSE_FAULT");
      }
    },
  },
);
configureAdmissionCase(
  "already returned configure ACK cannot capture recovery",
  async (h) => {
    const state = await prepareAdmittedConfigure(h);
    await captureAdmittedConfigureWrite(state.token).invoke();
    return state;
  },
  async (h, state) => {
    const before = h.calls.length;
    expect(() => captureAdmittedConfigureRecovery(state.token)).toThrow();
    expect(h.calls).toHaveLength(before);
  },
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
for (const phase of ["post", "append"] as const) {
  const entered = deferred(),
    released = deferred();
  let armed = false,
    appends = 0;
  configureAdmissionCase(
    "pending original " + phase + " refuses recovery even after visible commit",
    async (h) => {
      const state = await prepareAdmittedConfigure(h);
      armed = true;
      appends = 0;
      const original = captureAdmittedConfigureWrite(state.token).invoke();
      expect(
        await Promise.race([
          entered.promise.then(() => true),
          original.then(
            () => false,
            () => false,
          ),
        ]),
      ).toBe(true);
      if (phase === "append") {
        await vi.advanceTimersByTimeAsync(5001);
        expect(object(await original).status).toBe("configure_unknown");
      }
      return { ...state, original };
    },
    async (h, state) => {
      const before = h.calls.length;
      try {
        expect(() => captureAdmittedConfigureRecovery(state.token)).toThrow();
        expect(() =>
          readAdmittedConfigureAcknowledgement(state.token),
        ).toThrow();
        expect(h.calls).toHaveLength(before);
        expect(posts(h, state)).toHaveLength(1);
      } finally {
        released.resolve();
      }
      const result = await state.original;
      if (phase === "post")
        expect(object(result).status).toBe("configure_acknowledged");
      await vi.advanceTimersByTimeAsync(0);
    },
    {
      beforeFetch: async (path, method) => {
        if (
          armed &&
          phase === "post" &&
          method === "POST" &&
          path.startsWith("/v1/subscription_schedules/")
        ) {
          armed = false;
          entered.resolve();
          await released.promise;
        }
      },
      afterAppend: async () => {
        if (armed && phase === "append" && ++appends === 2) {
          armed = false;
          entered.resolve();
          await released.promise;
        }
      },
    },
  );
}
configureAdmissionCase(
  "actual safe response resumes without POST after C9 hashing fails",
  async (h) => {
    const state = await prepareAdmittedConfigure(h);
    const native = crypto.subtle.digest.bind(crypto.subtle);
    let fail = true;
    const digest = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation((algorithm, input) => {
        if (ArrayBuffer.isView(input)) {
          const tuple: unknown = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
            ),
          );
          if (
            fail &&
            Array.isArray(tuple) &&
            tuple[2] === "renewal-configured-baseline"
          ) {
            fail = false;
            return Promise.reject(Error("CONTROLLED_C9_HASH_FAULT"));
          }
        }
        return native(algorithm, input);
      });
    try {
      expect(
        object(await captureAdmittedConfigureWrite(state.token).invoke())
          .status,
      ).toBe("configure_unknown");
    } finally {
      digest.mockRestore();
    }
    expect(fail).toBe(false);
    expect(readOriginalConfigureAttempt(state.token).response).not.toBeNull();
    expect(readOriginalConfigureAttempt(state.token).receipt).toBeNull();
    return state;
  },
  async (h, state) => {
    const before = h.calls.length;
    const output = await captureAdmittedConfigureRecovery(state.token).invoke();
    expect(object(output).status).toBe("configure_acknowledged");
    expect(h.calls).toHaveLength(before);
    expect(
      readAdmittedConfigureAcknowledgement(state.token).output === output,
    ).toBe(true);
  },
);

unknownCase(
  "missing original fresh evidence cannot qualify recovery from disposition alone",
  async (h, state) => {
    const attempt = readOriginalConfigureAttempt(state.token);
    Reflect.set(attempt, "freshEvidence", null);
    const before = h.calls.length;
    expect(() => captureAdmittedConfigureRecovery(state.token)).toThrow();
    expect(h.calls).toHaveLength(before);
  },
);
