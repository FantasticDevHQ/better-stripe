import assert from "node:assert/strict";
import { it, vi } from "vitest";
import {
  configureWriteFixture,
  type ConfigureWriteFixture,
} from "../test-fixtures/configureWriteOperation.js";
import { data } from "../test-fixtures/configurePreflightControls.js";
import {
  assertConfigureACK,
  assertProviderFailure,
} from "../test-fixtures/configureWriteAssertions.js";

for (const name of [
  "dispatch-send",
  "dispatch-ack",
  "response-send",
  "response-ack",
  "receipt-send",
  "receipt-ack",
] as const)
  it("writer waits for BOTH actual send and ACK: " + name, async () => {
    const h = await configureWriteFixture(name),
      pending = h.captureWriter().invoke();
    const observed = pending.then(
      (value: unknown) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      await h.writeGates.entered(name, pending);
      assert.equal(
        h.writeState.calls.filter((row) => row.method === "POST").length,
        name.startsWith("dispatch") ? 0 : 1,
      );
      assert.equal(h.writeState.explicitC9, name.startsWith("receipt") ? 1 : 0);
      const sequence = name.startsWith("dispatch")
        ? 1
        : name.startsWith("response")
          ? 2
          : 3;
      assert.equal(h.writeState.records.length, sequence);
      assert.equal(
        h.writeState.trace.includes("ack:" + String(sequence)),
        name.endsWith("send"),
      );
      h.writeGates.release(name);
      const out = await observed;
      assert.equal(out.ok, true);
      if (out.ok) assertConfigureACK(h, out.value);
    } finally {
      h.writeGates.release(name);
      await observed;
      await h.cleanup();
    }
  });

for (const name of ["wrong-ack", "duplicate-ack"] as const)
  it(
    "live dispatch ACK failure reports actual trusted NOT_STARTED: " + name,
    async () => {
      const h = await configureWriteFixture(name);
      try {
        assert.deepEqual(await h.captureWriter().invoke(), {
          status: "not_dispatched",
          reason: "post_not_started",
          operationalAuthority: false,
        });
        assert.equal(h.writeState.records.length, 1);
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          0,
        );
        assert.equal(h.writeState.explicitC9, 0);
        assert.equal(h.OWNER.check().retired, false);
      } finally {
        await h.cleanup();
      }
    },
  );

it("safe response2 is retained before actualC9 identity refusal", async () => {
  const h = await configureWriteFixture("wrong-c9");
  try {
    assert.deepEqual(await h.captureWriter().invoke(), {
      status: "configure_unknown",
      reason: "post_unverified",
      operationalAuthority: false,
    });
    assert.equal(h.writeState.records.length, 2);
    assert.equal(h.writeState.explicitC9, 1);
    assert.equal(h.writeState.compilerC9, 0);
    assert.equal(
      h.writeState.calls.filter((row) => row.method === "POST").length,
      1,
    );
    assert.deepEqual(
      data(h.writeState.records[1]!.data).body,
      h.write.response,
    );
  } finally {
    await h.cleanup();
  }
});

for (const fault of ["output-publication", "receipt-ack"] as const)
  it(
    "known actualC9 closes old unknown ancestor before failed " + fault,
    async () => {
      let h: ConfigureWriteFixture | undefined,
        faults = 0;
      if (fault === "output-publication")
        vi.doMock("./output.js", async () => {
          const actual =
            await vi.importActual<typeof import("./output.js")>("./output.js");
          return {
            ...actual,
            admitConfigureACK(
              ...args: Parameters<typeof actual.admitConfigureACK>
            ) {
              const admitted = Reflect.apply(
                actual.admitConfigureACK,
                actual,
                args,
              ) as ReturnType<typeof actual.admitConfigureACK>;
              assert(h);
              assert.deepEqual(admitted, h.expectedACK);
              faults++;
              // Deliberate component abort after genuine admission, not a fabricated overflow claim.
              throw Error("TEST_PUBLICATION_ABORT_AFTER_ACTUAL_ACK_ADMISSION");
            },
          };
        });
      else
        vi.doMock("../c10/configureEvents.js", async () => {
          const actual = await vi.importActual<
            typeof import("../c10/configureEvents.js")
          >("../c10/configureEvents.js");
          return {
            ...actual,
            createConfigureEventCompiler(
              ...args: Parameters<typeof actual.createConfigureEventCompiler>
            ) {
              const options = data(args[1]),
                send = options.send;
              assert.equal(typeof send, "function");
              const injected = {
                ...options,
                send(record: unknown, acknowledge: (value: unknown) => void) {
                  const sequence = data(record).sequence;
                  const ack =
                    sequence === 3
                      ? (value: unknown) => {
                          faults++;
                          acknowledge({ ...data(value), binding: "wrong" });
                        }
                      : acknowledge;
                  return Reflect.apply(
                    send as (...values: unknown[]) => unknown,
                    options,
                    [record, ack],
                  );
                },
              };
              return Reflect.apply(
                actual.createConfigureEventCompiler,
                actual,
                [args[0], injected],
              ) as ReturnType<typeof actual.createConfigureEventCompiler>;
            },
          };
        });
      try {
        h = await configureWriteFixture("ack-closes-ancestor");
        const original = await h
          .captureWriter()
          .invoke()
          .then(
            () => assert.fail("EXPECTED_A_UNKNOWN"),
            (error: unknown) => error,
          );
        assertProviderFailure(h, original, "post");
        assert.deepEqual(await h.captureReplayB().invoke(), {
          status: "configure_unknown",
          reason: "post_unverified",
          operationalAuthority: false,
        });
        assert.equal(faults, 1);
        assert.equal(h.replayStates.B.explicitC9, 1);
        assert.equal(
          h.replayStates.B.records.length,
          fault === "receipt-ack" ? 3 : 2,
        );
        assert.equal(h.OWNER.check().retired, false);
        assert.deepEqual(await h.captureReplayC().invoke(), {
          status: "not_dispatched",
          reason: "prior_attempt_not_replayable",
          operationalAuthority: false,
        });
        assert.equal(h.replayStates.C.calls.length, 0);
        assert.equal(h.replayStates.C.pairLoads, 0);
        assert.deepEqual(h.expectedRecord.attachReceipt, h.acknowledgement);
      } finally {
        if (h) await h.cleanup();
        vi.doUnmock("./output.js");
        vi.doUnmock("../c10/configureEvents.js");
      }
    },
  );
