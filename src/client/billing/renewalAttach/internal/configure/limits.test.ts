import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { configureWriteFixture } from "../test-fixtures/configureWriteOperation.js";
import { limitCounterexample } from "../test-fixtures/configureWriteDeclarations.js";
import { ackSlots } from "../test-fixtures/configureWriteAssertions.js";
import { data } from "../test-fixtures/configurePreflightControls.js";
import {
  assertFit,
  metrics,
} from "../test-fixtures/configurePreflightAssertions.js";

for (const name of ["ack", "defaults-null", "defaults-object"] as const)
  it(
    "configure ACK DATA admits complete actual18/19 slots: " + name,
    async () => {
      const h = await configureWriteFixture(name);
      try {
        const { admitConfigureACK } = await import("./output.js");
        const out: unknown = Reflect.apply(admitConfigureACK, undefined, [
          h.expectedRecord,
          h.rawReceipt,
          h.expectedReceipt,
        ]);
        assert.deepEqual(out, h.expectedACK);
        assert(Object.isFrozen(out));
        assertFit(out);
        assert.equal(h.writeState.calls.length, 0);
      } finally {
        await h.cleanup();
      }
    },
  );

for (const name of [
  "special-keys",
  "repeated-reference",
  "numeric-array",
] as const)
  it(
    "configure ACK DATA preserves coherent actualC9 raw JSON: " + name,
    async () => {
      const mutate = (value: unknown) => limitCounterexample(value, name);
      const h = await configureWriteFixture();
      try {
        const candidate = data(mutate(h.expectedACK)),
          raw = data(candidate.rawReceipt);
        const actual = await vi.importActual<
          typeof import("../../../renewalV2/index.js")
        >("../../../renewalV2/index.js");
        const receipt: unknown = await Reflect.apply(
          actual.constructRenewalConfigurationReceiptV2,
          actual,
          [raw],
        );
        const { admitConfigureACK } = await import("./output.js");
        const out = data(
          Reflect.apply(admitConfigureACK, undefined, [
            h.expectedRecord,
            raw,
            receipt,
          ]),
        );
        assert.deepEqual(out, {
          status: "configure_acknowledged",
          originalRecord: h.expectedRecord,
          rawReceipt: raw,
          receipt,
          operationalAuthority: false,
        });
        assert.deepEqual(
          data(out.rawReceipt).providerSnapshot,
          raw.providerSnapshot,
        );
        assert(Object.isFrozen(out));
        assertFit(out);
        assert.equal(h.writeState.calls.length, 0);
      } finally {
        await h.cleanup();
      }
    },
  );

it("direct ACK DATA whole cap refuses after complete components and actualC9 fit", async () => {
  const opaque = "x".repeat(250000);
  const h = await configureWriteFixture();
  try {
    const raw = structuredClone(h.rawReceipt);
    Object.assign(raw.providerSnapshot, { opaque });
    const actual = await vi.importActual<
      typeof import("../../../renewalV2/index.js")
    >("../../../renewalV2/index.js");
    const receipt = await actual.constructRenewalConfigurationReceiptV2(raw);
    const parts = [
      assertFit(h.expectedRecord),
      assertFit(raw),
      assertFit(receipt),
    ];
    const expected = {
      status: "configure_acknowledged",
      originalRecord: h.expectedRecord,
      rawReceipt: raw,
      receipt,
      operationalAuthority: false,
    };
    const whole = metrics(expected);
    assert(
      whole.chars > 500000 || whole.bytes > 500000,
      "WHOLE_ACK_ONLY_OVERFLOW_PREREQUISITE",
    );
    assert(whole.nodes <= 10000 && whole.depth <= 40);
    const { admitConfigureACK } = await import("./output.js");
    assert.throws(
      () =>
        Reflect.apply(admitConfigureACK, undefined, [
          h.expectedRecord,
          raw,
          receipt,
        ]),
      {
        message: "CONFIGURE_WRITE_STOP",
      },
    );
    assert.equal(h.writeState.calls.length, 0);
    console.log(
      JSON.stringify({
        kind: "DIRECT_ACK_DATA_WHOLE_CAP",
        parts,
        whole,
        actorOverflowClaim: false,
      }),
    );
  } finally {
    await h.cleanup();
  }
});

for (const name of [
  "escaped-token",
  "raw-digest",
  "proxy",
  "accessor",
  "symbol",
  "nonenumerable",
  "cycle",
  "pan",
  "credential",
  "utf8",
  "nodes",
  "depth",
] as const)
  it(
    "direct ACK DATA refuses hostile or inconsistent complete input: " + name,
    async () => {
      const probes = { proxy: 0, getter: 0 };
      const mutate = (value: unknown) => {
        const result =
          name === "accessor"
            ? data(structuredClone(value))
            : data(limitCounterexample(value, name));
        const raw = data(result.rawReceipt);
        if (name === "accessor")
          Object.defineProperty(data(raw.providerSnapshot), "opaque", {
            enumerable: true,
            get() {
              probes.getter++;
              throw Error("TEST_ACCESSOR_REFLECTION");
            },
          });
        if (name === "proxy") {
          const target = raw.providerSnapshot;
          assert(target !== null && typeof target === "object");
          const trap = (): never => {
            probes.proxy++;
            throw Error("TEST_PROXY_REFLECTION");
          };
          raw.providerSnapshot = new Proxy(target, {
            get: trap,
            ownKeys: trap,
            getPrototypeOf: trap,
            getOwnPropertyDescriptor: trap,
          });
        }
        return result;
      };
      const h = await configureWriteFixture();
      try {
        const candidate = data(mutate(h.expectedACK));
        const { admitConfigureACK } = await import("./output.js");
        assert.throws(
          () =>
            Reflect.apply(admitConfigureACK, undefined, [
              candidate.originalRecord,
              candidate.rawReceipt,
              candidate.receipt,
            ]),
          { message: "CONFIGURE_WRITE_STOP" },
        );
        assert.deepEqual(probes, { proxy: 0, getter: 0 });
        assert.equal(h.writeState.calls.length, 0);
      } finally {
        await h.cleanup();
      }
    },
  );

it("failure DATA retains complete C6request and exact five generated positions", async () => {
  const diagnostics = Object.freeze({
    type: "StripeConnectionError",
    code: "ECONNRESET",
    requestId: "req_SYNTHETIC",
    statusCode: 409,
  });
  const h = await configureWriteFixture();
  try {
    const { admitConfigureFailure } = await import("./output.js");
    const failure = data(
      admitConfigureFailure(
        "post",
        "configure",
        5 + h.write.currentBundle.couponReads.length,
        h.projected,
        diagnostics,
      ),
    );
    assert.deepEqual(failure, {
      category: "provider_rejected",
      phase: "post",
      resource: "configure",
      ordinal: 5 + h.write.currentBundle.couponReads.length,
      request: h.projected,
      diagnostics,
      outcome: "unknown",
      operationalAuthority: false,
    });
    assert.deepEqual(Object.keys(failure).sort(), [
      "category",
      "diagnostics",
      "operationalAuthority",
      "ordinal",
      "outcome",
      "phase",
      "request",
      "resource",
    ]);
    assertFit(failure);
    assert(Object.isFrozen(failure));
    assert.equal(h.writeState.calls.length, 0);
  } finally {
    await h.cleanup();
  }
});

for (const diagnostics of [
  { type: "sk_live_SYNTHETIC_UNSAFE" },
  { unknown: "extra" },
  { requestId: "x".repeat(256) },
])
  it(
    "failure DATA rejects closed or unsafe diagnostics: " +
      Object.keys(diagnostics)[0],
    async () => {
      const h = await configureWriteFixture();
      try {
        const { admitConfigureFailure } = await import("./output.js");
        assert.throws(
          () =>
            Reflect.apply(admitConfigureFailure, undefined, [
              "post",
              "configure",
              7,
              h.projected,
              diagnostics,
            ]),
          { message: "CONFIGURE_WRITE_STOP" },
        );
      } finally {
        await h.cleanup();
      }
    },
  );

for (const [now, first, expected] of [
  [186399, 100000, true],
  [186400, 100000, false],
  [99999, 100000, false],
  [Number.MAX_SAFE_INTEGER + 1, 100000, false],
  [100000.5, 100000, false],
  [100000, -1, false],
] as const)
  it(
    "direct retention DATA boundary without Owner revival: " +
      String(now) +
      "/" +
      String(first),
    async () => {
      const { withinConfigureRetention } = await import("./replay.js");
      assert.equal(withinConfigureRetention(now, first), expected);
    },
  );

for (const mode of ["ack", "defaults-null", "defaults-object"] as const)
  it(
    "exact ACK ledger rejects missing or wrong-family generated positions: " +
      mode,
    async () => {
      const h = await configureWriteFixture(mode);
      try {
        const { admitConfigureACK } = await import("./output.js");
        const paths = ackSlots(h);
        assert.equal(paths.length, mode === "ack" ? 18 : 19);
        for (const path of paths)
          for (const mutation of ["missing", "wrong-family"] as const) {
            const candidate = data(structuredClone(h.expectedACK));
            let parent = candidate;
            for (const key of path.slice(0, -1)) parent = data(parent[key]);
            const key = path[path.length - 1]!;
            const original = parent[key];
            assert.equal(typeof original, "string");
            if (mutation === "missing") Reflect.deleteProperty(parent, key);
            else
              parent[key] =
                typeof original === "string" &&
                original.startsWith("renewal:v2:")
                  ? "renewal-configure-receipt:v2:sha256:" + "a".repeat(64)
                  : "renewal:v2:sha256:" + "a".repeat(64);
            assert.throws(
              () =>
                Reflect.apply(admitConfigureACK, undefined, [
                  candidate.originalRecord,
                  candidate.rawReceipt,
                  candidate.receipt,
                ]),
              { message: "CONFIGURE_WRITE_STOP" },
            );
          }
        const candidate = data(structuredClone(h.expectedACK)),
          receipt = data(candidate.receipt);
        if (mode === "ack")
          receipt.defaultSettingsBinding =
            "renewal-configured-defaults:v2:sha256:" + "a".repeat(64);
        else Reflect.deleteProperty(receipt, "defaultSettingsBinding");
        assert.throws(
          () =>
            Reflect.apply(admitConfigureACK, undefined, [
              candidate.originalRecord,
              candidate.rawReceipt,
              receipt,
            ]),
          { message: "CONFIGURE_WRITE_STOP" },
        );
        assert.equal(h.writeState.calls.length, 0);
      } finally {
        await h.cleanup();
      }
    },
  );

it("coherent actualC9 raw descendants and escaped keys have no generated privilege", async () => {
  const unsafeHex = "a".repeat(22) + "4242424242424242" + "b".repeat(26);
  const unsafeRawToken = "renewal:v2:sha256:" + unsafeHex;
  const ordinary64Digits = "renewal:v2:sha256:" + "1".repeat(64);
  const recipes = ["ancestor", "escaped"] as const;
  assert.equal(unsafeHex.length, 64);
  assert(/^renewal:v2:sha256:[0-9a-f]{64}$/.test(unsafeRawToken));
  const h = await configureWriteFixture();
  try {
    const { admitConfigureACK } = await import("./output.js");
    const { requiredJSONSnapshot } =
      await import("../material/requiredJson.js");
    assert.throws(() => requiredJSONSnapshot(unsafeRawToken), {
      message: "REQUIRED_JSON_PRIVACY_STOP",
    });
    assert.doesNotThrow(() => requiredJSONSnapshot(ordinary64Digits));
    const actual = await vi.importActual<
      typeof import("../../../renewalV2/index.js")
    >("../../../renewalV2/index.js");
    for (const recipe of recipes) {
      const candidate = data(structuredClone(h.expectedACK));
      const raw = data(candidate.rawReceipt),
        body = data(raw.providerSnapshot);
      if (recipe === "ancestor")
        body.opaque = {
          receipt: { request: { logicalBinding: unsafeRawToken } },
        };
      else
        Object.defineProperty(body, "/receipt/request/logicalBinding", {
          value: unsafeRawToken,
          enumerable: true,
        });
      // A constructor refusal is a failed prerequisite, never helper privacy coverage.
      const receipt: unknown = await Reflect.apply(
        actual.constructRenewalConfigurationReceiptV2,
        actual,
        [raw],
      );
      const r = data(receipt);
      assert.equal(r.stage, "configure_acknowledged");
      assert.deepEqual(raw.configuration, h.expectedRecord.configuration);
      assert.deepEqual(raw.actualDispatch, h.rawReceipt.actualDispatch);
      assert.deepEqual(r.request, h.projected);
      assert.deepEqual(raw.providerSnapshot, r.providerSnapshot);
      assert.deepEqual(raw.transport, r.transport);
      const components = [
        assertFit(candidate.originalRecord),
        assertFit(raw),
        assertFit(receipt),
      ];
      const full = {
        status: "configure_acknowledged",
        originalRecord: candidate.originalRecord,
        rawReceipt: raw,
        receipt,
        operationalAuthority: false,
      };
      const whole = assertFit(full);
      assert.throws(
        () =>
          Reflect.apply(admitConfigureACK, undefined, [
            candidate.originalRecord,
            raw,
            receipt,
          ]),
        { message: "CONFIGURE_WRITE_STOP" },
      );
      console.log(
        JSON.stringify({
          kind: "COHERENT_RAW_TOKEN_PRIVACY_BOUNDARY",
          recipe,
          components,
          whole,
          actualC9Prerequisite: true,
          bodyTransportEqual: true,
          actorApplicabilityClaim: false,
          sourceApplicabilityClaim: false,
        }),
      );
    }
    assert.equal(h.writeState.calls.length, 0);
  } finally {
    await h.cleanup();
  }
});

it("direct failure DATA whole cap refuses after provisional protocol component fits", async () => {
  // Fixed structural boundary formula, declared before constructors; never retried or fitted to a refusal.
  const targetRequestCharacters = 499500;
  const diagnostics = {
    type: "x".repeat(255),
    code: "x".repeat(255),
    requestId: "x".repeat(255),
    statusCode: 409,
  };
  const h = await configureWriteFixture();
  try {
    const candidate = data(structuredClone(h.projected));
    const phases = data(candidate.payload).phases;
    assert(Array.isArray(phases));
    const phase = data(phases[0]);
    phase.metadata = { opaque: "" };
    const fixedOverhead = JSON.stringify(candidate).length;
    assert(fixedOverhead < targetRequestCharacters);
    data(phase.metadata).opaque = "x".repeat(
      targetRequestCharacters - fixedOverhead,
    );
    const actual = await import("./output.js");
    // This is provisional DATA shape admission, not a new C6 projection or Source authentication.
    const component = actual.captureConfigureRequest(candidate);
    const componentMetrics = assertFit(component);
    assert.equal(componentMetrics.chars, targetRequestCharacters);
    const expected = {
      category: "provider_rejected",
      phase: "post",
      resource: "configure",
      ordinal: 7,
      request: component,
      diagnostics,
      outcome: "unknown",
      operationalAuthority: false,
    };
    const whole = metrics(expected);
    assert(
      whole.chars > 500000 && whole.bytes > 500000,
      "WHOLE_FAILURE_ONLY_OVERFLOW_PREREQUISITE",
    );
    assert(whole.nodes <= 10000 && whole.depth <= 40);
    assert.throws(
      () =>
        actual.admitConfigureFailure(
          "post",
          "configure",
          7,
          component,
          diagnostics,
        ),
      { message: "CONFIGURE_WRITE_STOP" },
    );
    assert.equal(h.writeState.calls.length, 0);
    console.log(
      JSON.stringify({
        kind: "DIRECT_FAILURE_DATA_WHOLE_CAP",
        componentMetrics,
        whole,
        actualC6ApplicabilityClaim: false,
        actorOverflowClaim: false,
      }),
    );
  } finally {
    await h.cleanup();
  }
});
