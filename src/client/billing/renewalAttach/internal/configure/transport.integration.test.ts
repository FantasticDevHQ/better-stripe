import assert from "node:assert/strict";
import { it, vi } from "vitest";
import {
  configureWriteFixture,
  type ConfigureWriteFixture,
} from "../test-fixtures/configureWriteOperation.js";
import { assertProviderFailure } from "../test-fixtures/configureWriteAssertions.js";

for (const name of [
  "get-reject",
  "post-reject",
  "conflict",
  "error-envelope-missing-optionals",
] as const)
  it(
    "writer actual strict provider rejection remains visible without retry: " +
      name,
    async () => {
      const h = await configureWriteFixture(name);
      try {
        const error = await h
          .captureWriter()
          .invoke()
          .then(
            () => assert.fail("EXPECTED_ACTUAL_PROVIDER_REJECTION"),
            (error: unknown) => error,
          );
        assertProviderFailure(
          h,
          error,
          name === "get-reject" ? "read" : "post",
        );
        if (name === "error-envelope-missing-optionals") {
          assert(error !== null && typeof error === "object");
          const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
          assert(descriptor && "value" in descriptor);
          const failure: unknown = descriptor.value;
          assert(failure !== null && typeof failure === "object");
          const diagnostics = Object.getOwnPropertyDescriptor(
            failure,
            "diagnostics",
          );
          assert(diagnostics && "value" in diagnostics);
          assert.deepEqual(diagnostics.value, {
            type: "StripeAPIError",
            statusCode: 409,
            requestId: "req_SYNTHETIC_CONFIGURE_WRITE",
          });
        }
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          name === "get-reject" ? 0 : 1,
        );
        assert(h.writeState.calls.length <= 45);
        assert.equal(
          h.writeState.records.length,
          name === "get-reject" ? 0 : 1,
        );
        assert.equal(h.writeState.explicitC9, 0);
      } finally {
        await h.cleanup();
      }
    },
  );

for (const name of [
  "unsafe-body",
  "unsafe-metadata",
  "diagnostics-empty",
  "redirect307",
  "redirect308",
] as const)
  it(
    "writer unsafe or non-2xx fulfilled response stays unknown: " + name,
    async () => {
      const h = await configureWriteFixture(name);
      try {
        assert.deepEqual(await h.captureWriter().invoke(), {
          status: "configure_unknown",
          reason: "post_unverified",
          operationalAuthority: false,
        });
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          1,
        );
        assert.equal(h.writeState.records.length, 1);
        assert.equal(h.writeState.explicitC9, 0);
        if (name === "redirect307" || name === "redirect308") {
          // The fake fetch asserts redirect:error but deliberately returns raw 3xx.
          // This proves non-2xx refusal, not native redirect following/rejection.
          assert.equal(
            h.writeState.calls.length,
            5 + h.write.currentBundle.couponReads.length,
          );
          assert.equal(h.writeState.compilerC9, 0);
          assert.equal(h.writeState.replies.length, 0);
          assert.equal(h.writeState.trace.includes("sink:2"), false);
        }
      } finally {
        await h.cleanup();
      }
    },
  );

for (const name of [
  "retire-get",
  "retire-post",
  "retire-response",
  "retire-receipt",
] as const)
  it(
    "writer original Owner closes at actual held boundary: " + name,
    async () => {
      const h = await configureWriteFixture(name),
        boundary = name.slice(7);
      const pending = h.captureWriter().invoke();
      const observed = pending.then(
        (value: unknown) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await h.writeGates.entered(boundary, pending);
        h.OWNER.retire();
        h.writeGates.release(boundary);
        const out = await observed;
        if (name === "retire-get") {
          assert.equal(out.ok, false);
          if (!out.ok)
            assert.equal((out.error as Error).message, "CONFIGURE_WRITE_STOP");
        } else {
          assert.equal(out.ok, true);
          if (out.ok)
            assert.deepEqual(out.value, {
              status: "configure_unknown",
              reason: "owner_closed_after_post",
              operationalAuthority: false,
            });
        }
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          name === "retire-get" ? 0 : 1,
        );
        assert.equal(
          h.writeState.records.length,
          name === "retire-receipt"
            ? 3
            : name === "retire-response"
              ? 2
              : name === "retire-post"
                ? 1
                : 0,
        );
        assert.equal(
          h.writeState.explicitC9,
          name === "retire-receipt" ? 1 : 0,
        );
        assert.deepEqual(h.expectedRecord.attachReceipt, h.acknowledgement);
      } finally {
        h.writeGates.release(boundary);
        await observed;
        await h.cleanup();
      }
    },
  );

it("retirement during actualC9 digest blocks owned receipt publication", async () => {
  const h = await configureWriteFixture("retire-c9");
  const subtle = globalThis.crypto.subtle,
    method = subtle.digest;
  let retired = false;
  vi.stubGlobal("crypto", {
    subtle: {
      digest(...args: Parameters<typeof method>) {
        const promise = Reflect.apply(method, subtle, args) as ReturnType<
          typeof method
        >;
        const input = args[1];
        assert(ArrayBuffer.isView(input));
        const tuple: unknown = JSON.parse(
          new TextDecoder().decode(
            new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
          ),
        );
        if (
          Array.isArray(tuple) &&
          tuple[0] === "betterstripe-renewal-binding" &&
          tuple[1] === 2 &&
          tuple[2] === "renewal-configure-receipt"
        )
          h.writeGates.pending.push(
            promise.then(
              () => {
                assert.equal(retired, false);
                assert.equal(h.writeGates.activeDigests.size, 0);
                retired = true;
                h.OWNER.retire();
              },
              () => {},
            ),
          );
        return promise;
      },
    },
  });
  try {
    assert.deepEqual(await h.captureWriter().invoke(), {
      status: "configure_unknown",
      reason: "owner_closed_after_post",
      operationalAuthority: false,
    });
    assert.equal(retired, true);
    assert.equal(h.writeState.explicitC9, 1);
    assert.equal(h.writeState.records.length, 2);
  } finally {
    await h.cleanup();
  }
});

it("retirement after actual receipt3 ACK retains history and blocks late success", async () => {
  let h: ConfigureWriteFixture | undefined;
  vi.doMock("../c10/configureEvents.js", async () => {
    const actual = await vi.importActual<
      typeof import("../c10/configureEvents.js")
    >("../c10/configureEvents.js");
    return {
      ...actual,
      createConfigureEventCompiler(
        ...args: Parameters<typeof actual.createConfigureEventCompiler>
      ) {
        const compiler = Reflect.apply(
          actual.createConfigureEventCompiler,
          actual,
          args,
        ) as ReturnType<typeof actual.createConfigureEventCompiler>;
        return Object.freeze({
          ...compiler,
          receipt(...xs: Parameters<typeof compiler.receipt>) {
            const promise = Reflect.apply(
              compiler.receipt,
              compiler,
              xs,
            ) as ReturnType<typeof compiler.receipt>;
            assert(h);
            const owned = h;
            owned.writeGates.pending.push(
              promise.then(
                () => {
                  assert.equal(owned.writeState.records.length, 3);
                  owned.OWNER.retire();
                },
                () => {},
              ),
            );
            return promise;
          },
        });
      },
    };
  });
  try {
    h = await configureWriteFixture("retire-final");
    assert.deepEqual(await h.captureWriter().invoke(), {
      status: "configure_unknown",
      reason: "owner_closed_after_post",
      operationalAuthority: false,
    });
    assert.equal(h.writeState.records.length, 3);
    assert.equal(h.writeState.explicitC9, 1);
    assert.equal(h.writeState.compilerC9, 1);
  } finally {
    if (h) await h.cleanup();
    vi.doUnmock("../c10/configureEvents.js");
  }
});

for (const mode of ["foreign-catch", "catch-once"] as const)
  it("actual pair catch origin and one-use: " + mode, async () => {
    const results: string[] = [];
    let firstReply: unknown;
    vi.doMock("./transport.js", async () => {
      const actual =
        await vi.importActual<typeof import("./transport.js")>(
          "./transport.js",
        );
      const wrap = (
        pair: ReturnType<typeof actual.createConfigureWriteTransport>,
      ) => {
        const capability = Object.fromEntries(
          Object.entries(pair.capability).map(([key, method]) => [
            key,
            (...args: unknown[]) => {
              if (key !== "consumePostCatch")
                return Reflect.apply(method, pair.capability, args);
              const foreign =
                firstReply ?? Object.freeze({ outcome: "post_unknown" });
              assert.equal(
                Reflect.apply(method, pair.capability, [foreign]),
                null,
              );
              results.push("foreign-refused");
              const fact: unknown = Reflect.apply(
                method,
                pair.capability,
                args,
              );
              assert(fact);
              assert.equal(Reflect.apply(method, pair.capability, args), null);
              results.push("genuine-once");
              firstReply = args[0];
              return fact;
            },
          ]),
        ) as typeof pair.capability;
        return Object.freeze({
          ...pair,
          capability: Object.freeze(capability),
        });
      };
      return {
        ...actual,
        createConfigureWriteTransport: () =>
          wrap(actual.createConfigureWriteTransport()),
        createConfigureReplayTransport: () =>
          wrap(actual.createConfigureReplayTransport()),
      };
    });
    let h: ConfigureWriteFixture | undefined;
    try {
      h = await configureWriteFixture(
        mode === "foreign-catch" ? "unknown-replay-repeat" : "post-reject",
      );
      const Aerror = await h
        .captureWriter()
        .invoke()
        .then(
          () => assert.fail("EXPECTED_A_UNKNOWN"),
          (error: unknown) => error,
        );
      assertProviderFailure(h, Aerror, "post");
      if (mode === "foreign-catch") {
        const Berror = await h
          .captureReplayB()
          .invoke()
          .then(
            () => assert.fail("EXPECTED_B_UNKNOWN"),
            (error: unknown) => error,
          );
        assertProviderFailure(
          { ...h, writeState: h.replayStates.B },
          Berror,
          "post",
        );
      }
      assert.deepEqual(
        results,
        mode === "foreign-catch"
          ? [
              "foreign-refused",
              "genuine-once",
              "foreign-refused",
              "genuine-once",
            ]
          : ["foreign-refused", "genuine-once"],
      );
    } finally {
      if (h) await h.cleanup();
      vi.doUnmock("./transport.js");
    }
  });

// Requires separately reviewed Source-fault TEST-family extension; not actual SDK/provider rejection evidence.
for (const name of [
  "source-post-sync-throw",
  "source-post-nonpromise",
] as const)
  it(
    "ambiguous Source start cannot qualify explicit replay: " + name,
    async () => {
      const h = await configureWriteFixture(name);
      try {
        assert.deepEqual(await h.captureWriter().invoke(), {
          status: "configure_unknown",
          reason: "post_unverified",
          operationalAuthority: false,
        });
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          0,
        );
        assert.equal(
          h.writeState.trace.filter((value) => value === name).length,
          1,
        );
        assert.equal(h.writeState.records.length, 1);
        assert.equal(h.writeState.explicitC9, 0);
        assert.equal(h.OWNER.check().retired, false);
        assert.deepEqual(await h.captureReplayB().invoke(), {
          status: "not_dispatched",
          reason: "prior_attempt_not_replayable",
          operationalAuthority: false,
        });
        assert.equal(h.replayStates.B.calls.length, 0);
        assert.equal(h.replayStates.B.pairLoads, 0);
      } finally {
        await h.cleanup();
      }
    },
  );

for (const [resource, ordinal] of [
  ["subscription", 1],
  ["price", 2],
  ["customer", 3],
  ["coupon0", 4],
  ["coupon1", 5],
  ["schedule", 6],
] as const)
  it(
    "original Owner closes at each actual declared GET await: " + resource,
    async () => {
      const h = await configureWriteFixture();
      assert.equal(
        4 + h.write.currentBundle.couponReads.length,
        6,
        "DECLARED_SIX_READ_PROFILE_PREREQUISITE",
      );
      const originalFetch = globalThis.fetch;
      // Deliberate fakeHTTP hold; the original stock SDK rawRequest Promise is unchanged.
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        const promise = Reflect.apply(originalFetch, globalThis, [
          input,
          init,
        ]) as ReturnType<typeof originalFetch>;
        const held = promise.then(async (response: Response) => {
          if (init?.method === "GET" && h.writeState.calls.length === ordinal)
            await h.writeGates.hold("selected-get");
          return response;
        });
        h.writeGates.pending.push(
          held.then(
            () => {},
            () => {},
          ),
        );
        return held;
      });
      const pending = h.captureWriter().invoke();
      const observed = pending.then(
        (value: unknown) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await h.writeGates.entered("selected-get", pending);
        assert.equal(h.writeState.calls.length, ordinal);
        h.OWNER.retire();
        h.writeGates.release("selected-get");
        const out = await observed;
        assert.equal(out.ok, false);
        if (!out.ok)
          assert.equal((out.error as Error).message, "CONFIGURE_WRITE_STOP");
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          0,
        );
        assert.equal(h.writeState.records.length, 0);
      } finally {
        h.writeGates.release("selected-get");
        await observed;
        await h.cleanup();
      }
      assert.equal(h.writeState.calls.length, ordinal);
    },
  );

it("retired owned continuation never reflects late hostile Source rejection", async () => {
  const h = await configureWriteFixture("source-post-hostile-late-reject");
  const pending = h.captureWriter().invoke();
  const observed = pending.then(
    (value: unknown) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await h.writeGates.entered("source-rejection", pending);
    h.OWNER.retire();
    h.writeGates.release("source-rejection");
    const out = await observed;
    assert.equal(out.ok, true);
    if (out.ok)
      assert.deepEqual(out.value, {
        status: "configure_unknown",
        reason: "owner_closed_after_post",
        operationalAuthority: false,
      });
    assert.equal(h.writeState.records.length, 1);
    assert.equal(
      h.writeState.calls.filter((row) => row.method === "POST").length,
      0,
    );
    assert.equal(h.writeState.traps, 0);
  } finally {
    h.writeGates.release("source-rejection");
    await observed;
    await h.cleanup();
  }
  assert.equal(h.writeState.traps, 0);
});
