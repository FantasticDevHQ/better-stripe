import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import {
  prepareRenewalPriceReplacementV2 as prepare,
  prepareRenewalScheduleAttachmentV2 as attach,
} from "./index.js";
import { prepareRenewalPriceReplacement as legacy } from "../renewalPriceReplacement.js";
import { prepareRenewalScheduleAttachment as legacyAttach } from "../renewalAttach/request.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";

const apiVersion = "2026-09-30.endive";
const firstDispatchedAt = 1700000001;
const c = (v: unknown) => JSON.stringify(renewalSnapshot(v));
const digest = (family: string, v: unknown) =>
  `${family}:v2:sha256:${createHash("sha256")
    .update(c(["betterstripe-renewal-binding", 2, family, v]), "utf8")
    .digest("hex")}`;
const unsigned = (p: any) => {
  const {
    status: _status,
    preservation: _preservation,
    requestIdentity: _requestIdentity,
    ...bound
  } = p;
  return bound;
};
const args = (prepared: any) => ({
  prepared,
  apiVersion,
  attachKey: "attach:explicit",
  firstDispatchedAt,
});
afterEach(() => vi.unstubAllGlobals());
it("constructs exact C1 bytes and all original semantic facts", async () => {
  const raw = input();
  const old = legacy(raw);
  const p = await prepare(raw);
  expect(p).toEqual({
    ...old,
    version: 2,
    requestIdentity: {
      key: old.requestIdentity.key,
      binding: digest("renewal", { ...unsigned(old), version: 2 }),
    },
  });
  expect(old.version).toBe(1);
  expect(old.requestIdentity.binding.startsWith("renewal:v1:")).toBe(true);
});
it("constructs exact complete C2 request, key and first-dispatch bytes", async () => {
  const p: any = await prepare(input());
  const r = await attach(args(p));
  const { requestIdentity, ...body } = r;
  expect(body).toEqual({
    version: 2,
    stage: "attach",
    scope: "platform",
    apiVersion,
    logicalBinding: p.requestIdentity.binding,
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: { from_subscription: "sub_original" },
    key: "attach:explicit",
    firstDispatchedAt,
  });
  expect(requestIdentity).toEqual({
    key: body.key,
    binding: digest("renewal-attach", body),
  });
});
it.each([
  "scope",
  "version",
  "status",
  "preservation",
  "quantity",
  "expected",
  "providerSnapshot",
  "requestIdentity",
  "extra",
])(
  "rejects tampered retained prepared %s by full recomputation",
  async (field) => {
    const p: any = await prepare(input());
    if (field === "scope") p.scope = "connected";
    else if (field === "version") p.version = 1;
    else if (field === "quantity") p.quantity = 99;
    else if (field === "expected") p.expected.targetPriceId = "price_foreign";
    else if (field === "providerSnapshot")
      p.providerSnapshot.subscription.metadata.original = "changed";
    else if (field === "requestIdentity")
      p.requestIdentity.binding = "renewal:v2:sha256:" + "0".repeat(64);
    else p[field] = "tampered";
    await expect(attach(args(p))).rejects.toThrow();
  },
);
it("does not adopt or migrate a V1 prepared record", async () => {
  await expect(attach(args(legacy(input())))).rejects.toThrow();
});
it.each(["method", "path", "scope", "payload", "unexpected"])(
  "rejects caller request override %s",
  async (field) => {
    const a: any = args(await prepare(input()));
    a[field] = field === "method" ? "GET" : "override";
    await expect(attach(a)).rejects.toThrow();
  },
);
it.each(["apiVersion", "attachKey", "firstDispatchedAt"])(
  "binds changed valid C2 %s or rejects unsupported values",
  async (field) => {
    const p: any = await prepare(input());
    const a = args(p);
    const original = await attach(a);
    const changed: any = { ...a };
    if (field === "apiVersion") {
      changed.apiVersion = "2025-01-01.acacia";
      await expect(attach(changed)).rejects.toThrow();
      return;
    }
    changed[field] =
      field === "attachKey" ? "attach:second" : firstDispatchedAt + 1;
    expect((await attach(changed)).requestIdentity.binding).not.toBe(
      original.requestIdentity.binding,
    );
  },
);
it.each(["", "\rkey", "x".repeat(256)])(
  "rejects invalid attach key",
  async (key) => {
    await expect(
      attach({ ...args(await prepare(input())), attachKey: key }),
    ).rejects.toThrow();
  },
);
it("retains ordinary product metadata including PAN-like and credential-like text", async () => {
  const raw = input();
  raw.subscription.metadata = {
    note: "4111111111111111",
    client_secret: "ordinary synthetic metadata",
  } as any;
  const p = await prepare(raw);
  expect(p.providerSnapshot.subscription.metadata).toEqual(
    raw.subscription.metadata,
  );
});
it("uses reviewed Unicode, numeric-index, escaping and negative-zero bytes", async () => {
  const raw = input();
  raw.subscription.metadata = {
    "10": "ten",
    "2": "two",
    z: "雪😀\ud800",
    a: '"\\\n',
    zero: -0,
  } as any;
  const p = await prepare(raw);
  expect(p.requestIdentity.binding).toBe(digest("renewal", unsigned(p)));
});
it.each(["target", "period", "quantity", "mode"])(
  "retains V1 semantic rejection for invalid %s",
  async (kind) => {
    const raw = input();
    if (kind === "target") raw.targetPrice.active = false;
    else if (kind === "period")
      raw.expected.periodEnd = raw.expected.periodStart;
    else if (kind === "quantity") raw.subscription.items.data[0].quantity = 0;
    else raw.targetPrice.livemode = true;
    expect(() => legacy(raw)).toThrow();
    await expect(prepare(raw)).rejects.toThrow();
  },
);
it("captures before awaiting hash and never rereads live input", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const hold = new Promise<void>((r) => (release = r));
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (name: any, bytes: any) => {
        entered();
        await hold;
        return webcrypto.subtle.digest(name, bytes);
      },
    },
  });
  const raw = input();
  const original = structuredClone(raw);
  const pending = prepare(raw);
  await Promise.race([started, pending]);
  raw.subscription.metadata.original = "MUTATED";
  raw.expected.targetPriceId = "price_foreign";
  release();
  const result = await pending;
  expect(
    (result.providerSnapshot.subscription.metadata as Record<string, unknown>)
      .original,
  ).toBe(original.subscription.metadata.original);
  expect(result.requestIdentity.binding).toBe(
    digest("renewal", unsigned(result)),
  );
});
it("captures full attach record before C1 verification awaits", async () => {
  const p: any = await prepare(input());
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const hold = new Promise<void>((r) => (release = r));
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (name: any, bytes: any) => {
        entered();
        await hold;
        return webcrypto.subtle.digest(name, bytes);
      },
    },
  });
  const a = args(p);
  const pending = attach(a);
  await Promise.race([started, pending]);
  a.attachKey = "changed";
  a.firstDispatchedAt++;
  p.providerSnapshot.subscription.metadata.original = "changed";
  release();
  const r = await pending;
  expect(r.key).toBe("attach:explicit");
  expect(r.firstDispatchedAt).toBe(firstDispatchedAt);
});
it.each(["missing", "rejected"])(
  "fails closed with %s WebCrypto and no fallback",
  async (mode) => {
    vi.stubGlobal(
      "crypto",
      mode === "missing"
        ? undefined
        : {
            subtle: {
              digest: () =>
                Promise.reject(new Error("synthetic digest refusal")),
            },
          },
    );
    await expect(prepare(input())).rejects.toThrow();
  },
);
it("enforces UTF8 cap on exact domain tuple at 500000 bytes including domain overhead", async () => {
  const raw = input();
  raw.subscription.metadata = { pad: "" } as any;
  const base = legacy(raw);
  const overhead = Buffer.byteLength(
    c([
      "betterstripe-renewal-binding",
      2,
      "renewal",
      { ...unsigned(base), version: 2 },
    ]),
    "utf8",
  );
  raw.subscription.metadata = { pad: "x".repeat(500000 - overhead) } as any;
  let calls = 0;
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (n: any, b: any) => {
        calls++;
        expect(b.byteLength).toBeLessThanOrEqual(500000);
        return webcrypto.subtle.digest(n, b);
      },
    },
  });
  expect((await prepare(raw)).version).toBe(2);
  expect(calls).toBe(1);
  raw.subscription.metadata = { pad: "x".repeat(500001 - overhead) } as any;
  await expect(prepare(raw)).rejects.toThrow();
  expect(calls).toBe(1);
});
it("rejects multibyte preimage exceeding UTF8 cap before hashing while V1 character input fits", async () => {
  const raw = input();
  raw.subscription.metadata = { pad: "雪".repeat(170000) } as any;
  expect(legacy(raw).version).toBe(1);
  const spy = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest: spy } });
  await expect(prepare(raw)).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
});
it("keeps V1 attach output unchanged", () => {
  const old = legacy(input());
  expect(legacyAttach(args(old))).toMatchObject({
    version: 1,
    scope: "platform",
    payload: { from_subscription: "sub_original" },
  });
});

it("keeps logical preparation key separate from C1 digest", async () => {
  const a = input();
  const b = input();
  b.key = "another:logical-key";
  const x = await prepare(a),
    y = await prepare(b);
  expect(x.requestIdentity.binding).toBe(y.requestIdentity.binding);
  expect(x.requestIdentity.key).not.toBe(y.requestIdentity.key);
});
it("exports additive V2 functions through the actual public SDK barrel", async () => {
  const sdk = await import("../../index.js");
  expect(sdk).toHaveProperty("prepareRenewalPriceReplacementV2", prepare);
  expect(sdk).toHaveProperty("prepareRenewalScheduleAttachmentV2", attach);
  expect(sdk.prepareRenewalPriceReplacement).toBe(legacy);
  expect(sdk).not.toHaveProperty("renewalBindingV2");
});

it.each(["nonfinite", "cycle", "accessor", "sparse"])(
  "rejects unsupported JSON %s before digest",
  async (kind) => {
    const raw = input() as any;
    const spy = vi.fn();
    vi.stubGlobal("crypto", { subtle: { digest: spy } });
    if (kind === "nonfinite") raw.subscription.metadata = { n: Infinity };
    else if (kind === "cycle") raw.subscription.metadata = raw;
    else if (kind === "accessor") {
      raw.subscription.metadata = {};
      Object.defineProperty(raw.subscription.metadata, "danger", {
        enumerable: true,
        get() {
          throw Error("getter must not execute");
        },
      });
    } else raw.subscription.metadata = { a: new Array(2) };
    await expect(prepare(raw)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  },
);
it("does not perform network access in either public pure constructor", async () => {
  const fetch = vi.fn(() => {
    throw Error("network forbidden");
  });
  vi.stubGlobal("fetch", fetch);
  const p: any = await prepare(input());
  await attach(args(p));
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["", "\ninvalid", "k".repeat(256)])(
  "keeps original logical-key validation",
  async (key) => {
    await expect(prepare({ ...input(), key })).rejects.toThrow();
  },
);

const expected = {
  customerAccountId: "acct_buyer",
  subscriptionId: "sub_original",
  itemId: "si_original",
  currentPriceId: "price_original",
  currentProductId: "prod_original",
  targetPriceId: "price_target",
  targetProductId: "prod_other",
  periodStart: 1700000000,
  periodEnd: 1702592000,
  livemode: false,
};

function price(id = "price_original", product = "prod_original") {
  return {
    id,
    product,
    object: "price",
    active: true,
    livemode: false,
    type: "recurring",
    currency: "usd",
    billing_scheme: "per_unit",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  };
}
function input() {
  return {
    expected: structuredClone(expected),
    key: "renewal:original-operation",
    subscription: {
      id: "sub_original",
      object: "subscription",
      customer_account: "acct_buyer",
      status: "active",
      currency: "usd",
      livemode: false,
      schedule: null,
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      pending_update: null,
      default_source: null,
      payment_settings: {
        payment_method_options: null,
        payment_method_types: null,
        save_default_payment_method: "off",
      },
      application_fee_percent: null,
      trial_end: 1690000000,
      items: {
        has_more: false,
        data: [
          {
            id: "si_original",
            object: "subscription_item",
            subscription: "sub_original",
            current_period_start: expected.periodStart,
            current_period_end: expected.periodEnd,
            quantity: 3,
            price: price(),
          },
        ],
      },
      metadata: { original: "keep" },
    },
    targetPrice: price("price_target", "prod_other"),
  };
}
