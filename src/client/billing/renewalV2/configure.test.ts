import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import * as sdk from "./index.js";
import { projectRenewalConfiguration as legacy } from "../renewalAggregate/configure.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  fixture,
  type FixtureOptions,
} from "../../../../tests/renewalAggregate/fixtures.js";

const project = (raw: any): Promise<any> =>
  sdk.projectRenewalConfigurationV2(raw);
function scenario(options: FixtureOptions = {}) {
  const f = fixture(options);
  const preparation = {
    subscription: f.subscription,
    targetPrice: f.targetPrice,
    billingCustomer: f.billingCustomer,
    expected: f.prepared.expected,
    key: f.prepared.requestIdentity.key,
  };
  const { apiVersion, payload, key, firstDispatchedAt } = f.attachRequest;
  const raw = {
    preparation,
    attachReceipt: {
      attachRequest: {
        preparation: structuredClone(preparation),
        apiVersion,
        attachKey: key,
        firstDispatchedAt,
      },
      actualDispatch: {
        scope: "platform" as const,
        apiVersion,
        method: "POST" as const,
        path: "/v1/subscription_schedules" as const,
        payload,
        key,
        firstDispatchedAt,
      },
      providerSnapshot: structuredClone(f.schedule),
    },
    freshSubscription: structuredClone(f.configureInput.freshSubscription),
    targetPrice: structuredClone(f.targetPrice),
    billingCustomer: structuredClone(f.billingCustomer),
    schedule: structuredClone(f.schedule),
    apiVersion,
    observedAt: f.configureInput.observedAt,
    firstDispatchedAt: f.configureInput.firstDispatchedAt,
    configureKey: f.configureInput.configureKey,
  };
  return { raw, old: f.configureInput };
}
const digest = (family: string, value: unknown) =>
  `${family}:v2:sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        renewalSnapshot(["betterstripe-renewal-binding", 2, family, value]),
      ),
      "utf8",
    )
    .digest("hex")}`;
afterEach(() => vi.unstubAllGlobals());
it.each([
  {},
  { targetInterval: "year" },
  { start: 1769731200, end: 1772150400, observedAt: 1769817600 },
])(
  "projects complete V1-equivalent phases/profile with direct C4/C5/C6 bindings %j",
  async (options) => {
    expect(sdk.projectRenewalConfigurationV2).toBeTypeOf("function");
    const { raw, old } = scenario(options),
      before = structuredClone(raw);
    const configurationOptions: sdk.ProjectRenewalConfigurationV2Options = raw;
    const result =
        await sdk.projectRenewalConfigurationV2(configurationOptions),
      original = legacy(old);
    expect(original.status).toBe("projected_configure_request");
    if (original.status !== "projected_configure_request")
      throw Error("fixture");
    expect(result.status).toBe("projected_configure_request");
    if (result.status !== "projected_configure_request")
      throw Error("projection");
    expect(result.payload).toEqual(original.payload);
    expect(result.profile).toEqual(original.profile);
    expect(result.version).toBe(2);
    expect(result.providerQualification).toBe("required");
    expect(result.baselineBinding).toBe(
      digest("renewal-baseline", raw.attachReceipt.providerSnapshot),
    );
    expect(result.defaultSettingsBinding).toBe(
      digest("renewal-defaults", raw.schedule.default_settings),
    );
    const {
      status: _status,
      profile: _profile,
      providerQualification: _qualification,
      requestIdentity,
      ...unsigned
    } = result;
    expect(requestIdentity).toEqual({
      key: raw.configureKey,
      binding: digest("renewal-configure", unsigned),
    });
    expect(raw).toEqual(before);
    expect(result.payload).not.toHaveProperty("default_settings");
    expect(result.payload.phases[1]).not.toHaveProperty("end_date");
  },
);
it.each([
  [
    "distinct key",
    (x: any) => {
      x.configureKey =
        x.attachReceipt.actualDispatch?.key ?? x.attachReceipt.request.key;
    },
  ],
  [
    "dispatch ordering",
    (x: any) => {
      x.firstDispatchedAt = x.observedAt + 1;
    },
  ],
  [
    "source drift",
    (x: any) => {
      x.freshSubscription.currency = "eur";
    },
  ],
  [
    "association",
    (x: any) => {
      x.freshSubscription.schedule = null;
    },
  ],
  [
    "baseline",
    (x: any) => {
      x.schedule.opaque_future_field = true;
    },
  ],
])("preserves exact existing Failure data for %s", async (_name, mutate) => {
  const { raw, old } = scenario();
  mutate(raw);
  mutate(old);
  expect(await project(raw)).toEqual(legacy(old));
});
it.each([
  { item: { current_trial: { trial_end: 1770000000 } } },
  { phase: { trial: true } },
  { defaults: { collection_method: "unsupported" } },
])(
  "preserves unsupported owned-Schedule Failure reasons %j",
  async (options) => {
    const { raw, old } = scenario(options);
    expect(await project(raw)).toEqual(legacy(old));
  },
);
it("keeps invalid receipt aliases before the owned-Schedule failure boundary", async () => {
  const { raw } = scenario();
  raw.apiVersion = "different";
  expect(await project(raw)).toEqual({
    status: "conflict",
    reason: "invalid_attach_receipt_binding",
  });
});
it("rejects repeated raw preparation differences instead of accepting child claims", async () => {
  const { raw } = scenario();
  raw.attachReceipt.attachRequest.preparation.key = "other:logical";
  expect((await project(raw)).status).not.toBe("projected_configure_request");
  const invalid: any = scenario().raw;
  invalid.prepared = fixture().prepared;
  await expect(project(invalid)).rejects.toThrow();
});
it.each(["root", "preparation", "attachReceipt"])(
  "rejects unknown %s names before inspecting values",
  async (where) => {
    const { raw } = scenario();
    const value: any =
      where === "root" ? raw : raw[where as "preparation" | "attachReceipt"];
    const read = vi.fn();
    Object.defineProperty(value, "unexpected", { enumerable: true, get: read });
    await expect(project(raw)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  },
);
it("rechecks captured required fields before any digest after reflection mutation", async () => {
  const { raw } = scenario();
  const target: any = raw;
  const proxy = new Proxy(target, {
    getPrototypeOf(object) {
      delete object.observedAt;
      return Object.prototype;
    },
  });
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  await expect(project(proxy)).rejects.toThrow();
  expect(digest).not.toHaveBeenCalled();
});
it("preserves absent-vs-present input fields and requires actual default settings", async () => {
  const missing: any = scenario().raw;
  delete missing.schedule.default_settings;
  expect((await project(missing)).status).not.toBe(
    "projected_configure_request",
  );
  const explicit: any = scenario().raw;
  explicit.billingCustomer = undefined;
  await expect(project(explicit)).rejects.toThrow();
});
it("owns all inputs before awaiting hashing", async () => {
  const { raw } = scenario();
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  vi.stubGlobal("crypto", {
    subtle: {
      async digest(
        algorithm: string,
        bytes: Parameters<typeof webcrypto.subtle.digest>[1],
      ) {
        if (++calls === 1) await held;
        return webcrypto.subtle.digest(algorithm, bytes);
      },
    },
  });
  const pending = project(raw);
  raw.freshSubscription.schedule = null as any;
  raw.configureKey = "changed";
  release();
  const result = await pending;
  expect(result.status).toBe("projected_configure_request");
  expect(result.key).not.toBe("changed");
});
it("projects substantial bounded raw bodies without building nested V1 claims", async () => {
  const { raw } = scenario();
  for (const body of [raw.schedule, raw.attachReceipt.providerSnapshot])
    (body as any).opaque_retained = "x".repeat(90000);
  expect(JSON.stringify(raw).length).toBeLessThan(500000);
  const result = await project(raw);
  expect(result.status).toBe("projected_configure_request");
  expect(result.requestIdentity.binding.length).toBeLessThan(100);
});
it("returns the existing unsupported union when hashing fails", async () => {
  vi.stubGlobal("crypto", {
    subtle: { digest: () => Promise.reject(Error("failure")) },
  });
  expect(await project(scenario().raw)).toEqual({
    status: "conflict",
    reason: "invalid_prepared_binding",
  });
});
it("preserves the owned-Schedule failure boundary when a later binding fails", async () => {
  let calls = 0;
  vi.stubGlobal("crypto", {
    subtle: {
      async digest(
        algorithm: string,
        bytes: Parameters<typeof webcrypto.subtle.digest>[1],
      ) {
        if (++calls === 6) throw Error("late digest failure");
        return webcrypto.subtle.digest(algorithm, bytes);
      },
    },
  });
  expect(await project(scenario().raw)).toEqual({
    status: "attached_unconfigured",
    scheduleId: "sub_sched_owned",
    reason: "incomplete_or_unsupported_schema",
  });
});
it("retains the old missing-optional-Customer failure without inventing a read", async () => {
  const f: any = scenario();
  delete f.raw.billingCustomer;
  delete f.old.billingCustomer;
  expect(await project(f.raw)).toEqual(legacy(f.old));
});
it("does not accept a mismatched complete attachment dispatch through C6", async () => {
  const f = scenario();
  f.raw.attachReceipt.actualDispatch.payload.from_subscription = "sub_foreign";
  expect(await project(f.raw)).toEqual({
    status: "conflict",
    reason: "invalid_attach_receipt_binding",
  });
});
const ownSpecial = (body: object, value: unknown) =>
  Object.defineProperty(body, "__proto__", { enumerable: true, value });
it("preserves identical full Schedule special own JSON keys in C4 and comparison", async () => {
  const f = scenario();
  ownSpecial(f.raw.schedule, { retained: true });
  ownSpecial(f.raw.attachReceipt.providerSnapshot, { retained: true });
  const before = structuredClone(f.raw),
    result = await project(f.raw);
  expect(result.status).toBe("projected_configure_request");
  expect(result.baselineBinding).toBe(
    digest("renewal-baseline", f.raw.attachReceipt.providerSnapshot),
  );
  expect(result.defaultSettingsBinding).toBe(
    digest("renewal-defaults", f.raw.schedule.default_settings),
  );
  expect(f.raw).toEqual(before);
});
it("binds special own-key changes and rejects real full-baseline drift", async () => {
  const a = scenario(),
    b = scenario();
  for (const body of [a.raw.schedule, a.raw.attachReceipt.providerSnapshot])
    ownSpecial(body, { retained: 1 });
  for (const body of [b.raw.schedule, b.raw.attachReceipt.providerSnapshot])
    ownSpecial(body, { retained: 2 });
  const x = await project(a.raw),
    y = await project(b.raw);
  expect(x.status).toBe("projected_configure_request");
  expect(y.status).toBe("projected_configure_request");
  expect(x.baselineBinding).not.toBe(y.baselineBinding);
  expect(x.requestIdentity.binding).not.toBe(y.requestIdentity.binding);
  const mismatched = scenario();
  ownSpecial(mismatched.raw.schedule, { retained: true });
  expect(await project(mismatched.raw)).toEqual({
    status: "conflict",
    reason: "acknowledged_baseline_or_defaults_drift",
  });
});
it("does not drop unknown special own keys from strict default mappings to accept them", async () => {
  const f = scenario();
  for (const body of [
    f.raw.schedule.default_settings,
    f.raw.attachReceipt.providerSnapshot.default_settings,
  ])
    ownSpecial(body, { unsupported: true });
  expect(await project(f.raw)).toEqual({
    status: "attached_unconfigured",
    scheduleId: "sub_sched_owned",
    reason: "unsupported_schedule_defaults",
  });
});
it("keeps V1 Schedule parsing after its original key validation boundary", () => {
  const f = scenario();
  f.old.configureKey = f.old.attachReceipt.request.key;
  f.old.schedule = null as any;
  expect(legacy(f.old)).toEqual({
    status: "attached_unconfigured",
    scheduleId: "sub_sched_owned",
    reason: "configure_key_must_be_distinct",
  });
  f.old.configureKey = "another:configure-key";
  expect(legacy(f.old)).toEqual({
    status: "attached_unconfigured",
    scheduleId: "sub_sched_owned",
    reason: "incomplete_or_unsupported_schema",
  });
});
it("exports the pure public API without exposing shared internal material helpers", async () => {
  const root = await import("../../index.js");
  expect(root).toHaveProperty(
    "projectRenewalConfigurationV2",
    sdk.projectRenewalConfigurationV2,
  );
  expect(root).not.toHaveProperty("validateReadMaterial");
  expect(root).not.toHaveProperty("configureMaterial");
});
