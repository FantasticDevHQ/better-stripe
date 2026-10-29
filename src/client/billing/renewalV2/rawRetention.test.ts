import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import * as sdk from "./index.js";
import { prepareRenewalPriceReplacement as legacy } from "../renewalPriceReplacement.js";
import { validateReadMaterial } from "../renewalAggregate/readMaterial.js";
import { fixture } from "../../../../tests/renewalAggregate/fixtures.js";
import {
  at,
  binding,
  bound,
  configuration,
  expandedInput,
  hash,
  input,
  own,
  owns,
  paths,
} from "../../../../tests/renewalAggregate/rawRetention.js";

afterEach(() => vi.unstubAllGlobals());
it("records unaffected normal full-output vectors and independent C1 oracle", async () => {
  const raw = input(),
    old = legacy(raw),
    p = await sdk.prepareRenewalPriceReplacementV2(raw);
  expect(p.requestIdentity.binding).toBe(
    binding("renewal", { ...bound(old), version: 2 }),
  );
  const c = configuration(),
    receipt = await sdk.constructRenewalScheduleAttachmentReceiptV2(
      c.attachReceipt,
    ),
    projected = await sdk.projectRenewalConfigurationV2(c);
  expect(projected.status).toBe("projected_configure_request");
  expect({
    legacy: hash(old),
    prepared: hash(p),
    receipt: hash(receipt),
    configuration: hash(projected),
  }).toEqual({
    legacy: "ed0e7fe3641e216caf66fd225b1a7366a4a3ab7f2825448ec9fbbf697621e150",
    prepared:
      "4c27c7f4c0f4743d6a5ff3c76da42c024c4f2e29f6bc65b4ad29bb21dfdbc8d3",
    receipt: "dd79636e1248efc8efad99737bcd156d322f3078aea7ecebf007f0d1d953b01c",
    configuration:
      "ef08ad09044c32eaa3152b3a7fe058a68f77edf704c3176ada86cd5c5c6179d8",
  });
});
it.each(paths.map((path) => ({ path })))(
  "retains and binds safe own proto at passthrough body $path",
  async ({ path }) => {
    const raw = expandedInput(),
      body = at(raw, path as (string | number)[]);
    own(body, "__proto__", { safe: "retained" });
    const expected = {
      subscription: raw.subscription,
      targetPrice: raw.targetPrice,
      billingCustomer: raw.billingCustomer,
    };
    const old = legacy(raw),
      p = await sdk.prepareRenewalPriceReplacementV2(raw);
    expect(old.providerSnapshot).toEqual(expected);
    expect(p.providerSnapshot).toEqual(expected);
    expect(
      owns(at(p.providerSnapshot, path as (string | number)[]), "__proto__"),
    ).toBe(true);
    expect(p.requestIdentity.binding).toBe(
      binding("renewal", {
        version: 2,
        scope: "platform",
        expected: raw.expected,
        quantity: raw.subscription.items.data[0].quantity,
        providerSnapshot: expected,
      }),
    );
    own(body, "__proto__", { safe: "changed" });
    expect(
      (await sdk.prepareRenewalPriceReplacementV2(raw)).requestIdentity.binding,
    ).not.toBe(p.requestIdentity.binding);
  },
);
it.each(["subscription", "targetPrice", "billingCustomer"])(
  "same raw %s special key passes internal read eligibility",
  (field) => {
    const raw: any = input();
    own(raw[field], "__proto__", { safe: "same" });
    const f = fixture();
    const prepared: any = {
      expected: raw.expected,
      quantity: raw.subscription.items.data[0].quantity,
      providerSnapshot: {
        subscription: raw.subscription,
        targetPrice: raw.targetPrice,
        billingCustomer: raw.billingCustomer,
      },
    };
    const args = {
      freshSubscription: structuredClone(raw.subscription),
      targetPrice: structuredClone(raw.targetPrice),
      billingCustomer: structuredClone(raw.billingCustomer),
      apiVersion: f.preflightInput.apiVersion,
      observedAt: f.preflightInput.observedAt,
    };
    expect(() => validateReadMaterial(args, prepared)).not.toThrow();
    own(
      (args as any)[field === "subscription" ? "freshSubscription" : field],
      "__proto__",
      { safe: "drift" },
    );
    expect(() => validateReadMaterial(args, prepared)).toThrow();
  },
);
it.each(["subscription", "targetPrice", "billingCustomer"])(
  "C1 C3 C6 uses identical full raw %s and rejects fresh drift",
  async (field) => {
    const raw: any = input();
    own(raw[field], "__proto__", { safe: "same" });
    const c = configuration(raw);
    expect((await sdk.projectRenewalConfigurationV2(c)).status).toBe(
      "projected_configure_request",
    );
    own(
      c[field === "subscription" ? "freshSubscription" : field],
      "__proto__",
      { safe: "drift" },
    );
    expect((await sdk.projectRenewalConfigurationV2(c)).status).toBe(
      "conflict",
    );
  },
);
it.each(["constructor", "prototype"])(
  "retains safe own %s without prototype pollution",
  async (key) => {
    const raw: any = input();
    for (const body of [raw.subscription, raw.targetPrice, raw.billingCustomer])
      own(body, key, { prototype: { BTS313_POLLUTED: true } });
    const p = await sdk.prepareRenewalPriceReplacementV2(raw);
    expect(p.providerSnapshot.subscription[key]).toEqual(raw.subscription[key]);
    expect(Object.getPrototypeOf(p.providerSnapshot.subscription)).toBe(
      Object.prototype,
    );
    expect((Object.prototype as any).BTS313_POLLUTED).toBeUndefined();
  },
);
it("keeps opaque unknown nested raw JSON and strict eligibility distinct", async () => {
  const raw: any = input();
  own(raw.subscription.metadata, "__proto__", { opaque: true });
  raw.subscription.items.data[0].plan = { opaque: true };
  own(raw.subscription.items.data[0].plan, "__proto__", { nested: true });
  const p = await sdk.prepareRenewalPriceReplacementV2(raw);
  expect(p.providerSnapshot.subscription.metadata).toEqual(
    raw.subscription.metadata,
  );
  expect((p.providerSnapshot.subscription.items.data[0] as any).plan).toEqual(
    raw.subscription.items.data[0].plan,
  );
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const invalid: any = input();
    own(invalid.subscription.payment_settings, key, { extra: true });
    await expect(
      sdk.prepareRenewalPriceReplacementV2(invalid),
    ).rejects.toThrow();
  }
});
it("preserves Customer absence and rejects invalid present Customer", async () => {
  const raw: any = input();
  delete raw.billingCustomer;
  expect(
    owns(
      (await sdk.prepareRenewalPriceReplacementV2(raw)).providerSnapshot,
      "billingCustomer",
    ),
  ).toBe(false);
  raw.billingCustomer = null;
  await expect(sdk.prepareRenewalPriceReplacementV2(raw)).rejects.toThrow();
});
it("keeps C3 C4 complete Schedule bodies and C5 raw default preimage", async () => {
  const c = configuration();
  own(c.attachReceipt.providerSnapshot, "__proto__", { schedule: true });
  own(c.schedule, "__proto__", { schedule: true });
  const r = await sdk.constructRenewalScheduleAttachmentReceiptV2(
    c.attachReceipt,
  );
  expect(owns(r.providerSnapshot, "__proto__")).toBe(true);
  expect(r.providerSnapshot).toEqual(c.attachReceipt.providerSnapshot);
  const projected = await sdk.projectRenewalConfigurationV2(c);
  expect(projected.status).toBe("projected_configure_request");
  if (projected.status !== "projected_configure_request")
    throw Error("fixture");
  expect(projected.baselineBinding).toBe(
    binding("renewal-baseline", c.attachReceipt.providerSnapshot),
  );
  expect(projected.defaultSettingsBinding).toBe(
    binding("renewal-defaults", c.schedule.default_settings),
  );
  own(c.schedule.default_settings, "__proto__", { unsupported: true });
  c.attachReceipt.providerSnapshot = structuredClone(c.schedule);
  expect((await sdk.projectRenewalConfigurationV2(c)).status).toBe(
    "attached_unconfigured",
  );
});
it("captures retained raw keys before WebCrypto await and leaves no live alias", async () => {
  const raw: any = input();
  own(raw.subscription, "__proto__", { value: "before" });
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (n: any, b: any) => {
        entered();
        await hold;
        return webcrypto.subtle.digest(n, b);
      },
    },
  });
  const pending = sdk.prepareRenewalPriceReplacementV2(raw);
  await Promise.race([started, pending]);
  raw.subscription.__proto__.value = "after";
  release();
  const p = await pending;
  expect((p.providerSnapshot.subscription as any).__proto__).toEqual({
    value: "before",
  });
});
it("does not turn custom prototypes/accessors or overbudget raw data into retained JSON", async () => {
  for (const kind of ["prototype", "accessor", "budget"]) {
    const raw: any = input();
    if (kind === "prototype")
      Object.setPrototypeOf(raw.subscription, { foreign: true });
    else if (kind === "accessor")
      Object.defineProperty(raw.subscription, "bad", {
        enumerable: true,
        get() {
          throw Error("must not invoke getter");
        },
      });
    else own(raw.subscription, "__proto__", { pad: "x".repeat(500001) });
    await expect(sdk.prepareRenewalPriceReplacementV2(raw)).rejects.toThrow();
  }
});
it("retained restored fields keep UTF8 hash caps and cannot adopt a stale binding", async () => {
  const raw: any = input();
  own(raw.subscription, "__proto__", { pad: "雪".repeat(170000) });
  expect(legacy(raw).providerSnapshot.subscription).toEqual(raw.subscription);
  const spy = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest: spy } });
  await expect(sdk.prepareRenewalPriceReplacementV2(raw)).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  const p: any = await sdk.prepareRenewalPriceReplacementV2(input());
  own(p.providerSnapshot.subscription, "__proto__", { newRaw: true });
  await expect(
    sdk.prepareRenewalScheduleAttachmentV2({
      prepared: p,
      apiVersion: "2026-09-30.endive",
      attachKey: "explicit:attach",
      firstDispatchedAt: 1768867200,
    }),
  ).rejects.toThrow();
});
it("C5 retains eligible opaque special keys inside validated expanded defaults", async () => {
  const p: any = input();
  p.subscription.default_payment_method = {
    id: "pm_retained",
    object: "payment_method",
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    livemode: false,
  };
  const c = configuration(p);
  c.schedule.default_settings.default_payment_method = structuredClone(
    p.subscription.default_payment_method,
  );
  own(c.schedule.default_settings.default_payment_method, "__proto__", {
    safe: "one",
  });
  c.attachReceipt.providerSnapshot = structuredClone(c.schedule);
  const first = await sdk.projectRenewalConfigurationV2(c);
  expect(first.status).toBe("projected_configure_request");
  if (first.status !== "projected_configure_request") throw Error("fixture");
  expect(first.defaultSettingsBinding).toBe(
    binding("renewal-defaults", c.schedule.default_settings),
  );
  own(c.schedule.default_settings.default_payment_method, "__proto__", {
    safe: "two",
  });
  c.attachReceipt.providerSnapshot = structuredClone(c.schedule);
  const second = await sdk.projectRenewalConfigurationV2(c);
  expect(second.status).toBe("projected_configure_request");
  if (second.status !== "projected_configure_request") throw Error("fixture");
  expect(second.defaultSettingsBinding).not.toBe(first.defaultSettingsBinding);
});
