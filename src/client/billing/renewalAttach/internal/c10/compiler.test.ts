import type { EventRecord } from "./ownData.js";
import "./test-fixtures/semanticSetup.js";
import { it as test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const { fixture, copy, wire, sdk } =
  await import("./test-fixtures/fixture.mjs");
const { createAttachEventCompiler, createConfigureEventCompiler } =
  await import("./test-fixtures/compilerIndex.mjs");
const canonical = (v: unknown): string =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [
                k,
                JSON.parse(canonical((v as Record<string, unknown>)[k])),
              ]),
          )
      : v,
  );
const oracle = (r: EventRecord) =>
  "unbound-qualification-event:v2:sha256:" +
  createHash("sha256")
    .update(
      canonical([
        "betterstripe-renewal-binding",
        2,
        "unbound-qualification-event",
        { sequence: r.sequence, data: r.data },
      ]),
    )
    .digest("hex");
const delivery = () => {
  const records: EventRecord[] = [];
  return {
    records,
    options: {
      timeoutMs: 5000,
      send: async (r: EventRecord, ack: (value: unknown) => void) => {
        records.push(r);
        ack({ sequence: r.sequence, binding: r.binding });
      },
    },
  };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Stage = "attach" | "configure";
const events = (f: Fixture, stage: Stage) =>
  stage === "attach"
    ? [
        { event: "dispatch", stage, request: f.request },
        {
          event: "response",
          stage,
          request: f.request,
          body: f.s.attach.providerSnapshot,
          status: 200,
        },
        { event: "receipt", stage, request: f.request, receipt: f.attach },
      ]
    : [
        { event: "dispatch", stage, request: f.configure },
        {
          event: "response",
          stage,
          request: f.configure,
          body: f.s.configuredBody,
          transport: f.transport,
        },
        { event: "receipt", stage, request: f.configure, receipt: f.stored },
      ];
const owner = (f: Fixture, stage: Stage, d: ReturnType<typeof delivery>) =>
  stage === "attach"
    ? createAttachEventCompiler(f.sourceAttach, d.options)
    : createConfigureEventCompiler(f.sourceConfigure, d.options);
for (const stage of ["attach", "configure"] as const)
  test(
    stage +
      " all three lexical events bind whole envelopes with independent C10 oracle",
    async () => {
      const f = await fixture(),
        d = delivery(),
        c = owner(f, stage, d),
        es = events(f, stage);
      for (const e of es)
        await c[e.event as "dispatch" | "response" | "receipt"](e);
      assert.equal(d.records.length, 3);
      for (const [i, r] of d.records.entries()) {
        assert.equal(r.sequence, i + 1);
        assert.equal(r.binding, oracle(r));
        assert.deepEqual(r.data, es[i]);
        assert.ok(Object.isFrozen((r.data as { request: unknown }).request));
      }
      assert.equal(Object.prototype.hasOwnProperty.call(c, "qualified"), false);
    },
  );
for (const stage of ["attach", "configure"] as const)
  test(
    stage + " safe wrong identity response recorded before receipt failure",
    async () => {
      const f = await fixture(),
        d = delivery(),
        c = owner(f, stage, d),
        es = events(f, stage);
      await c.dispatch(es[0]);
      const wrong = copy(es[1]);
      wrong.body.customer_account = "acct_Foreign";
      await c.response(wrong);
      await assert.rejects(c.receipt(es[2]), /C10_SOURCE_STOP/);
      assert.equal(d.records.length, 2);
      assert.equal(
        (d.records[1].data as { body: Record<string, unknown> }).body
          .customer_account,
        "acct_Foreign",
      );
    },
  );
test("all seven wire request mutations rejected without any send", async () => {
  const f = await fixture();
  for (const [k, value] of Object.entries({
    scope: "connected",
    apiVersion: "other",
    method: "GET",
    path: "/other",
    payload: { from_subscription: "sub_Other" },
    key: "OTHER",
    firstDispatchedAt: 1,
  })) {
    const d = delivery(),
      c = owner(f, "attach", d),
      e = copy(events(f, "attach")[0]);
    e.request[k] = value;
    await assert.rejects(c.dispatch(e), /C10_SOURCE_STOP/);
    assert.equal(d.records.length, 0, k);
  }
});
test("synchronous first lock prevents concurrent initial calls through async hash", async () => {
  const f = await fixture(),
    d = delivery(),
    c = owner(f, "attach", d),
    e = events(f, "attach")[0];
  const a = c.dispatch(e),
    b = c.dispatch(e);
  await Promise.all([
    assert.rejects(a, /C10_SOURCE_STOP/),
    assert.rejects(b, /C10_SOURCE_STOP/),
  ]);
  assert.equal(d.records.length, 0);
});
test("unknown/symbol/accessor event keys rejected without getter or digest", async () => {
  const f = await fixture();
  const original = globalThis.crypto.subtle.digest;
  let calls = 0;
  globalThis.crypto.subtle.digest = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    for (const kind of ["unknown", "symbol", "accessor"]) {
      const d = delivery(),
        c = owner(f, "attach", d),
        e = copy(events(f, "attach")[0]);
      let got = 0;
      if (kind === "unknown") e.extra = true;
      if (kind === "symbol") e[Symbol("extra")] = true;
      if (kind === "accessor")
        Object.defineProperty(e, "request", {
          enumerable: true,
          get() {
            got++;
            throw Error("GETTER");
          },
        });
      await assert.rejects(c.dispatch(e), /C10_SOURCE_STOP/);
      assert.equal(got, 0);
      assert.equal(d.records.length, 0);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
test("source root descriptor mutation removing required apiVersion stops before hash", async () => {
  const f = await fixture(),
    d = delivery(),
    raw = copy(f.sourceAttach);
  let calls = 0;
  const original = globalThis.crypto.subtle.digest;
  globalThis.crypto.subtle.digest = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const p = new Proxy(raw, {
      getPrototypeOf(t) {
        delete t.apiVersion;
        return Object.prototype;
      },
    });
    assert.throws(
      () => createAttachEventCompiler(p, d.options),
      /C10_SOURCE_STOP/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
test("body secret/client_secret empty never sent, getter never read", async () => {
  const f = await fixture();
  for (const kind of ["text", "name", "accessor"]) {
    const d = delivery(),
      c = owner(f, "attach", d),
      es = events(f, "attach");
    await c.dispatch(es[0]);
    const e = copy(es[1]);
    let got = 0;
    if (kind === "text") e.body.extra = "sk_test_SYNTHETIC";
    if (kind === "name") e.body.client_secret = "";
    if (kind === "accessor")
      Object.defineProperty(e.body, "extra", {
        enumerable: true,
        get() {
          got++;
          throw Error("SECRET");
        },
      });
    await assert.rejects(c.response(e), /C10_SOURCE_STOP/);
    assert.equal(got, 0);
    assert.equal(d.records.length, 1);
  }
});
test("capture before first await detaches event and raw source mutation", async () => {
  const f = await fixture(),
    d = delivery(),
    raw = copy(f.sourceAttach),
    c = createAttachEventCompiler(raw, d.options),
    e = copy(events(f, "attach")[0]);
  const p = c.dispatch(e);
  raw.attachKey = "CHANGED";
  raw.preparation.subscription.metadata.extra = "CHANGED";
  e.request.payload.from_subscription = "sub_CHANGED";
  await p;
  assert.deepEqual(d.records[0].data, events(f, "attach")[0]);
});
test("foreign/reordered/duplicate branch permanently stops owner", async () => {
  const f = await fixture();
  for (const method of ["response", "receipt"] as const) {
    const d = delivery(),
      c = owner(f, "attach", d);
    await assert.rejects(
      c[method](events(f, "attach")[method === "response" ? 1 : 2]),
      /C10_SOURCE_STOP/,
    );
    await assert.rejects(c.dispatch(events(f, "attach")[0]), /C10_SOURCE_STOP/);
    assert.equal(d.records.length, 0);
  }
  const d = delivery(),
    c = owner(f, "attach", d);
  await c.dispatch(events(f, "attach")[0]);
  await assert.rejects(c.dispatch(events(f, "attach")[0]), /C10_SOURCE_STOP/);
  assert.equal(d.records.length, 1);
});
test("receipt body mutation cannot replace same-response full reconstruction", async () => {
  const f = await fixture(),
    d = delivery(),
    c = owner(f, "configure", d),
    es = events(f, "configure");
  await c.dispatch(es[0]);
  await c.response(es[1]);
  const e = copy(es[2]);
  e.receipt.providerSnapshot.metadata.changed = "ordinary";
  await assert.rejects(c.receipt(e), /C10_SOURCE_STOP/);
  assert.equal(d.records.length, 2);
});

test("new whole event UTF8, nodes and depth limits stop complete response", async () => {
  const f = await fixture();
  for (const kind of ["utf8", "nodes", "depth"]) {
    const d = delivery(),
      c = owner(f, "attach", d),
      es = events(f, "attach");
    await c.dispatch(es[0]);
    const e = copy(es[1]);
    if (kind === "utf8") e.body.extra = "é".repeat(250001);
    if (kind === "nodes")
      e.body.extra = Array.from({ length: 10001 }, () => null);
    if (kind === "depth") {
      let v = null;
      for (let i = 0; i < 41; i++) v = { next: v };
      e.body.extra = v;
    }
    await assert.rejects(c.response(e), /C10_SOURCE_STOP/);
    assert.equal(d.records.length, 1, kind);
  }
});
test("new opaque own proto response key retained and C10-sensitive", async () => {
  const f = await fixture();
  const bindings = [];
  for (const value of ["alpha", "beta"]) {
    const d = delivery(),
      c = owner(f, "attach", d),
      es = events(f, "attach"),
      body = copy(es[1].body);
    Object.defineProperty(body, "__proto__", {
      value: { opaque: value },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    await c.dispatch(es[0]);
    await c.response({ ...es[1], body });
    const receipt = await sdk.constructRenewalScheduleAttachmentReceiptV2({
      attachRequest: f.sourceAttach,
      actualDispatch: wire(f.request),
      providerSnapshot: body,
    });
    await c.receipt({ ...es[2], receipt });
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        (d.records[1].data as { body: Record<string, unknown> }).body,
        "__proto__",
      ),
      true,
    );
    assert.equal(
      (d.records[1].data as { body: { __proto__: { opaque: unknown } } }).body
        .__proto__.opaque,
      value,
    );
    assert.equal(
      Object.getPrototypeOf(
        (d.records[1].data as { body: Record<string, unknown> }).body,
      ),
      Object.prototype,
    );
    bindings.push(d.records[1].binding);
  }
  assert.notEqual(bindings[0], bindings[1]);
  assert.equal((Object.prototype as Record<string, unknown>).opaque, undefined);
});
test("new optional configured defaults absent null object preserve distinct exact C8", async () => {
  const f = await fixture();
  for (const mode of ["absent", "null", "object"]) {
    const d = delivery(),
      c = owner(f, "configure", d),
      es = events(f, "configure"),
      body = copy(es[1].body);
    if (mode === "absent") delete body.default_settings;
    if (mode === "null") body.default_settings = null;
    const receipt = await sdk.constructRenewalConfigurationReceiptV2({
      configuration: f.sourceConfigure,
      actualDispatch: wire(f.configure),
      providerSnapshot: body,
      transport: f.transport,
    });
    await c.dispatch(es[0]);
    await c.response({ ...es[1], body });
    await c.receipt({ ...es[2], receipt });
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        (d.records[2].data as { receipt: unknown }).receipt,
        "defaultSettingsBinding",
      ),
      mode !== "absent",
    );
    assert.deepEqual(
      (d.records[2].data as { receipt: unknown }).receipt,
      receipt,
    );
  }
});
test("new nested request identity deletion during reflection rejects before digest", async () => {
  const f = await fixture(),
    d = delivery(),
    c = owner(f, "attach", d),
    e = copy(events(f, "attach")[0]);
  const target = e.request.requestIdentity;
  e.request.requestIdentity = new Proxy(target, {
    getPrototypeOf(t) {
      delete t.binding;
      return Object.prototype;
    },
  });
  let hashes = 0;
  const original = globalThis.crypto.subtle.digest;
  globalThis.crypto.subtle.digest = function (...args) {
    hashes++;
    return original.apply(this, args);
  };
  try {
    await assert.rejects(c.dispatch(e), /C10_SOURCE_STOP/);
    assert.equal(hashes, 0);
    assert.equal(d.records.length, 0);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
test("new real derived PAN-looking claim accepted only at recomputed fixed slot", async () => {
  const f = await fixture();
  let selected;
  const pan = /(?:^|\D)(?:\d[ -]?){12,18}\d(?:$|\D)/i;
  for (let i = 0; i < 200 && !selected; i++) {
    const raw = copy(f.sourceAttach);
    raw.preparation.subscription.metadata.c10_vector = "SYNTHETIC" + i;
    const prepared = await sdk.prepareRenewalPriceReplacementV2(
        raw.preparation,
      ),
      request = await sdk.prepareRenewalScheduleAttachmentV2({
        prepared,
        apiVersion: raw.apiVersion,
        attachKey: raw.attachKey,
        firstDispatchedAt: raw.firstDispatchedAt,
      });
    if (
      pan.test(request.logicalBinding) ||
      pan.test(request.requestIdentity.binding)
    )
      selected = { raw, request };
  }
  assert.ok(selected, "bounded deterministic derived-claim vector must exist");
  const d = delivery(),
    c = createAttachEventCompiler(selected.raw, d.options);
  await c.dispatch({
    event: "dispatch",
    stage: "attach",
    request: selected.request,
  });
  assert.equal(d.records.length, 1);
  const e = {
    event: "response",
    stage: "attach",
    request: selected.request,
    body: { extra: "1234567890123456" },
    status: 200,
  };
  await assert.rejects(c.response(e), /C10_SOURCE_STOP/);
  assert.equal(d.records.length, 1);
});
