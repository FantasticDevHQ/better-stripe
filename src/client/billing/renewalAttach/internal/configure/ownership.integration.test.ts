import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { configureWriteFixture } from "../test-fixtures/configureWriteOperation.js";
import { assertConfigureACK } from "../test-fixtures/configureWriteAssertions.js";
import { writeCases } from "../test-fixtures/configureWriteDeclarations.js";

for (const name of writeCases.ownership.filter((value) => value !== "empty"))
  it(
    "bounded configure writer closes ownership frontier: " + name,
    async () => {
      const h = await configureWriteFixture(name);
      try {
        if (name === "capture-arity")
          assert.throws(() => Reflect.apply(h.captureWriter, undefined, [{}]), {
            message: "CONFIGURE_WRITE_STOP",
          });
        else if (name === "invoke-arity")
          await assert.rejects(
            Reflect.apply(h.captureWriter().invoke, undefined, [{}]),
            { message: "CONFIGURE_WRITE_STOP" },
          );
        else if (name === "consumed") {
          const handle = h.captureWriter();
          assertConfigureACK(h, await handle.invoke());
          await assert.rejects(handle.invoke(), {
            message: "CONFIGURE_WRITE_STOP",
          });
        } else if (name === "original-failure") {
          const result = await h.captureWriter().invoke();
          assert.equal(result, h.writeState.requests[0]);
          assert.notEqual(
            (result as { status?: unknown }).status,
            "projected_configure_request",
          );
        } else
          await assert.rejects(async () => h.captureWriter().invoke(), {
            message: "CONFIGURE_WRITE_STOP",
          });
        if (name === "consumed") {
          assert.equal(
            h.writeState.calls.filter((row) => row.method === "POST").length,
            1,
          );
          return;
        }
        assert.equal(h.writeState.calls.length, 0);
        assert.equal(h.writeState.records.length, 0);
        assert.equal(h.writeState.traps, 0);
        if (name === "original-failure") {
          assert.equal(h.writeState.requests.length, 1);
          assert.equal(h.writeState.pairLoads, 0);
          assert.equal(h.writeState.coverage, 0);
        }
      } finally {
        await h.cleanup();
      }
    },
  );

it("normal writer EMPTY returns refusal before Source, Owner, clock and API effects", async () => {
  vi.resetModules();
  const counts = {
    Source: 0,
    Owner: 0,
    check: 0,
    sample: 0,
    client: 0,
    api: 0,
  };
  const effect = (key: keyof typeof counts): never => {
    counts[key]++;
    throw Error("EMPTY_EFFECT_" + key);
  };
  vi.doMock("../originalOwner.js", () => ({
    OWNER: new Proxy(
      Object.freeze({
        check: () => effect("check"),
        sample: () => effect("sample"),
      }),
      {
        get(target, key, receiver) {
          counts.Owner++;
          return Reflect.get(target, key, receiver);
        },
      },
    ),
  }));
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => effect("Source"),
    loadFixedStockClient: () => effect("client"),
  }));
  vi.doMock("../operations/sourceOperations.js", async () => {
    const actual = await vi.importActual<
      typeof import("../operations/sourceOperations.js")
    >("../operations/sourceOperations.js");
    assert.deepEqual(actual.COMPILED_CONFIGURE_WRITE_ENTRIES, []);
    return {
      ...actual,
      loadFixedConfigureWriteOperation: () => effect("Source"),
      loadConfigureWriteTransportSource: () => effect("Source"),
      loadFixedConfigureReplayOperation: () => effect("Source"),
      loadConfigureReplayTransportSource: () => effect("Source"),
    };
  });
  vi.doMock("../../../renewalV2/index.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../../renewalV2/index.js")
    >("../../../renewalV2/index.js");
    return {
      ...actual,
      projectRenewalConfigurationV2: () => effect("api"),
      constructRenewalScheduleAttachmentReceiptV2: () => effect("api"),
      constructRenewalConfigurationReceiptV2: () => effect("api"),
    };
  });
  try {
    const actual = await import("./actor.js");
    const expected = {
      status: "not_dispatched",
      reason: "no_qualified_configure_class",
      operationalAuthority: false,
    };
    assert.deepEqual(await actual.captureOwnedConfigureV2().invoke(), expected);
    assert.deepEqual(
      await actual.captureOwnedConfigureReplayV2().invoke(),
      expected,
    );
    assert.deepEqual(counts, {
      Source: 0,
      Owner: 0,
      check: 0,
      sample: 0,
      client: 0,
      api: 0,
    });
  } finally {
    for (const path of [
      "../originalOwner.js",
      "../sourceBindings.js",
      "../operations/sourceOperations.js",
      "../../../renewalV2/index.js",
    ])
      vi.doUnmock(path);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
