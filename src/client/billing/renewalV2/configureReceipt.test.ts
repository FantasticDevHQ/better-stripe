import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import * as sdk from "./index.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { fixture } from "../../../../tests/renewalAggregate/fixtures.js";

const construct = (raw: any) => sdk.constructRenewalConfigurationReceiptV2(raw);
async function input() {
  const f = fixture(),
    preparation = {
      subscription: f.subscription,
      targetPrice: f.targetPrice,
      billingCustomer: f.billingCustomer,
      expected: f.prepared.expected,
      key: f.prepared.requestIdentity.key,
    };
  const configuration = {
    preparation,
    attachReceipt: {
      attachRequest: {
        preparation: structuredClone(preparation),
        apiVersion: f.attachRequest.apiVersion,
        attachKey: f.attachRequest.key,
        firstDispatchedAt: f.attachRequest.firstDispatchedAt,
      },
      actualDispatch: {
        scope: "platform" as const,
        apiVersion: f.attachRequest.apiVersion,
        method: "POST" as const,
        path: "/v1/subscription_schedules" as const,
        payload: f.attachRequest.payload,
        key: f.attachRequest.key,
        firstDispatchedAt: f.attachRequest.firstDispatchedAt,
      },
      providerSnapshot: structuredClone(f.schedule),
    },
    freshSubscription: f.configureInput.freshSubscription,
    targetPrice: f.targetPrice,
    billingCustomer: f.billingCustomer,
    schedule: structuredClone(f.schedule),
    apiVersion: f.configureInput.apiVersion,
    observedAt: f.configureInput.observedAt,
    firstDispatchedAt: f.configureInput.firstDispatchedAt,
    configureKey: f.configureInput.configureKey,
  };
  const request = await sdk.projectRenewalConfigurationV2(configuration);
  if (request.status !== "projected_configure_request") throw Error("fixture");
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  return {
    configuration,
    actualDispatch: {
      scope,
      apiVersion,
      method,
      path,
      payload,
      key,
      firstDispatchedAt,
    },
    providerSnapshot: structuredClone(f.schedule),
    transport: { status: 200 } as { status: number; requestId?: string },
  };
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
it("constructs the complete unsigned C9 record with independent C7/C8/C9 hashes", async () => {
  expect(sdk.constructRenewalConfigurationReceiptV2).toBeTypeOf("function");
  const raw = await input(),
    before = structuredClone(raw);
  const options: sdk.ConstructRenewalConfigurationReceiptV2Options = raw;
  const result: sdk.RenewalConfigurationReceiptV2 =
    await sdk.constructRenewalConfigurationReceiptV2(options);
  expect(result).toMatchObject({
    version: 2,
    stage: "configure_acknowledged",
    scope: "platform",
    verification: "owned_response_only",
    scheduleId: "sub_sched_owned",
    subscriptionId: "sub_original",
    customerAccountId: "acct_buyer",
    billingCustomerId: "cus_buyer",
    livemode: false,
  });
  expect(result.request).toEqual(
    await sdk.projectRenewalConfigurationV2(raw.configuration),
  );
  expect(result.providerSnapshot).toEqual(raw.providerSnapshot);
  expect(result.transport).toEqual(raw.transport);
  expect(result.providerSnapshotBinding).toBe(
    digest("renewal-configured-baseline", raw.providerSnapshot),
  );
  expect(result.defaultSettingsBinding).toBe(
    digest(
      "renewal-configured-defaults",
      raw.providerSnapshot.default_settings,
    ),
  );
  const { binding, ...unsigned } = result;
  expect(binding).toBe(digest("renewal-configure-receipt", unsigned));
  expect(raw).toEqual(before);
  expect(JSON.stringify(result).length).toBeLessThan(500000);
});
it.each([
  "scope",
  "apiVersion",
  "method",
  "path",
  "payload",
  "key",
  "firstDispatchedAt",
])("compares complete actual configure dispatch %s", async (field) => {
  const raw: any = await input();
  raw.actualDispatch[field] =
    field === "payload"
      ? { ...raw.actualDispatch.payload, extra: true }
      : field === "firstDispatchedAt"
        ? raw.actualDispatch[field] + 1
        : "changed";
  await expect(construct(raw)).rejects.toThrow();
});
it.each([199, 300, 200.5, NaN])(
  "rejects invalid transport status %s before hashing",
  async (status) => {
    const raw = await input();
    raw.transport.status = status;
    const digest = vi.fn();
    vi.stubGlobal("crypto", { subtle: { digest } });
    await expect(construct(raw)).rejects.toThrow();
    expect(digest).not.toHaveBeenCalled();
  },
);
it.each([200, 299])(
  "retains actual transport status %s and optional request ID",
  async (status) => {
    const raw = await input();
    raw.transport = { status, requestId: "r".repeat(status === 200 ? 1 : 255) };
    expect((await construct(raw)).transport).toEqual(raw.transport);
  },
);
it.each(["", "r".repeat(256), 0, null, undefined])(
  "rejects present invalid requestId %s",
  async (requestId) => {
    const raw: any = await input();
    raw.transport.requestId = requestId;
    await expect(construct(raw)).rejects.toThrow();
  },
);
it.each(["absent", "null", "object"])(
  "preserves configured defaults presence %s without inventing application facts",
  async (kind) => {
    const raw: any = await input();
    if (kind === "absent") delete raw.providerSnapshot.default_settings;
    else
      raw.providerSnapshot.default_settings =
        kind === "null" ? null : { future_field: ["retained"] };
    const result = await construct(raw);
    expect(result.providerSnapshot).toEqual(raw.providerSnapshot);
    expect(
      Object.prototype.hasOwnProperty.call(result, "defaultSettingsBinding"),
    ).toBe(kind !== "absent");
    if (kind !== "absent")
      expect(result.defaultSettingsBinding).toBe(
        digest(
          "renewal-configured-defaults",
          raw.providerSnapshot.default_settings,
        ),
      );
    const { binding, ...unsigned } = result;
    expect(binding).toBe(digest("renewal-configure-receipt", unsigned));
  },
);
it("preserves special own JSON keys throughout response, defaults and hashes", async () => {
  const raw: any = await input();
  for (const body of [
    raw.providerSnapshot,
    raw.providerSnapshot.default_settings,
  ])
    Object.defineProperty(body, "__proto__", {
      enumerable: true,
      value: { retained: true },
    });
  const result = await construct(raw);
  expect(result.providerSnapshot).toEqual(
    JSON.parse(JSON.stringify(raw.providerSnapshot)),
  );
  expect(
    Object.prototype.hasOwnProperty.call(result.providerSnapshot, "__proto__"),
  ).toBe(true);
  expect(result.providerSnapshotBinding).toBe(
    digest("renewal-configured-baseline", raw.providerSnapshot),
  );
  expect(result.defaultSettingsBinding).toBe(
    digest(
      "renewal-configured-defaults",
      raw.providerSnapshot.default_settings,
    ),
  );
});
it.each([
  "schedule",
  "customer",
  "subscription",
  "account",
  "mode",
  "deleted",
  "expanded",
])("rejects incompatible available response identity %s", async (kind) => {
  const raw: any = await input(),
    b = raw.providerSnapshot;
  if (kind === "schedule") b.id = "sub_sched_foreign";
  else if (kind === "account") b.customer_account = "acct_other";
  else if (kind === "mode") b.livemode = true;
  else if (kind === "deleted") b.deleted = true;
  else if (kind === "expanded")
    b.subscription = {
      id: "sub_original",
      object: "subscription",
      schedule: {
        id: b.id,
        object: "subscription_schedule",
        customer: "cus_foreign",
      },
    };
  else b[kind] = kind === "customer" ? "cus_foreign" : "sub_foreign";
  await expect(construct(raw)).rejects.toThrow();
});
it("records operation-only consistency without requiring phases/defaults to match the request", async () => {
  const raw: any = await input();
  raw.providerSnapshot.phases = [{ observed: "different" }];
  raw.providerSnapshot.default_settings = null;
  const result = await construct(raw);
  expect(result.request.payload.phases).toHaveLength(2);
  expect(result.providerSnapshot.phases).toEqual([{ observed: "different" }]);
  expect(result).not.toHaveProperty("nativeQualificationAccepted");
});
it.each([true, false])(
  "rejects own lastResponse even when enumerable=%s",
  async (enumerable) => {
    const raw = await input();
    Object.defineProperty(raw.providerSnapshot, "lastResponse", {
      enumerable,
      value: null,
    });
    await expect(construct(raw)).rejects.toThrow();
  },
);
it.each(["root", "configuration", "actualDispatch", "transport"])(
  "rejects unknown %s names before inspecting values",
  async (where) => {
    const raw: any = await input(),
      target = where === "root" ? raw : raw[where];
    const read = vi.fn();
    Object.defineProperty(target, "unexpected", {
      enumerable: true,
      get: read,
    });
    await expect(construct(raw)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  },
);
it("rechecks required nested configuration fields after capture before hashing", async () => {
  const raw: any = await input(),
    target = raw.configuration;
  raw.configuration = new Proxy(target, {
    getPrototypeOf(t) {
      delete t.observedAt;
      return Object.prototype;
    },
  });
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  await expect(construct(raw)).rejects.toThrow();
  expect(digest).not.toHaveBeenCalled();
});
it("rejects C6 Failure with a fixed error while C6 itself retains Failure data", async () => {
  const raw = await input();
  raw.configuration.configureKey =
    raw.configuration.attachReceipt.actualDispatch.key;
  expect(
    await sdk.projectRenewalConfigurationV2(raw.configuration),
  ).toMatchObject({
    status: "attached_unconfigured",
    reason: "configure_key_must_be_distinct",
  });
  await expect(construct(raw)).rejects.toThrow(
    "Invalid renewal configuration receipt input.",
  );
});
it("captures response/transport/default presence before its first await", async () => {
  const raw: any = await input(),
    before = structuredClone(raw);
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
  const pending = construct(raw);
  raw.providerSnapshot.customer = "cus_changed";
  delete raw.providerSnapshot.default_settings;
  raw.transport.requestId = "changed";
  release();
  const result = await pending;
  expect(result.providerSnapshot).toEqual(before.providerSnapshot);
  expect(result.transport).toEqual(before.transport);
});
it.each(["reject", "invalid"])(
  "rejects %s crypto responses without fallback",
  async (kind) => {
    const raw = await input();
    vi.stubGlobal("crypto", {
      subtle: {
        digest: () =>
          kind === "reject"
            ? Promise.reject(Error("private"))
            : Promise.resolve(new ArrayBuffer(1)),
      },
    });
    await expect(construct(raw)).rejects.toThrow(
      "Invalid renewal configuration receipt input.",
    );
  },
);
it("enforces UTF-8 preimage and complete input budgets", async () => {
  const raw: any = await input();
  raw.providerSnapshot.unicode = "\u0800".repeat(170000);
  await expect(construct(raw)).rejects.toThrow();
  raw.providerSnapshot.unicode = "x".repeat(500000);
  await expect(construct(raw)).rejects.toThrow();
});
it("rejects excessive input depth before hashing", async () => {
  const raw: any = await input();
  let nested: unknown = null;
  for (let i = 0; i < 41; i++) nested = { next: nested };
  raw.providerSnapshot.deep = nested;
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  await expect(construct(raw)).rejects.toThrow();
  expect(digest).not.toHaveBeenCalled();
});
it("fits near-limit complete input and retains bounded output without truncation", async () => {
  const raw: any = await input();
  raw.providerSnapshot.padding = "";
  raw.providerSnapshot.padding = "x".repeat(
    500000 - JSON.stringify(raw).length - 256,
  );
  const inputBytes = Buffer.byteLength(JSON.stringify(raw), "utf8"),
    result = await construct(raw);
  const outputBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  expect(inputBytes).toBe(499744);
  expect(outputBytes).toBeLessThanOrEqual(500000);
  expect(result.providerSnapshot.padding).toBe(raw.providerSnapshot.padding);
  raw.providerSnapshot.padding += "x".repeat(512);
  await expect(construct(raw)).rejects.toThrow();
});
it.each([
  "renewal-configured-baseline",
  "renewal-configured-defaults",
  "renewal-configure-receipt",
])("rejects late errors and invalid digests for %s", async (family) => {
  for (const kind of ["reject", "invalid"]) {
    const raw = await input();
    let reached = false;
    vi.stubGlobal("crypto", {
      subtle: {
        async digest(
          algorithm: string,
          bytes: Parameters<typeof webcrypto.subtle.digest>[1],
        ) {
          const encoded = JSON.parse(
            Buffer.from(bytes as Uint8Array).toString("utf8"),
          );
          if (encoded[2] === family) {
            reached = true;
            if (kind === "reject") throw Error("private");
            return new ArrayBuffer(1);
          }
          return webcrypto.subtle.digest(algorithm, bytes);
        },
      },
    });
    await expect(construct(raw)).rejects.toThrow(
      "Invalid renewal configuration receipt input.",
    );
    expect(reached).toBe(true);
    vi.unstubAllGlobals();
  }
});
it("accepts complete matching expanded response identities", async () => {
  const raw: any = await input();
  raw.providerSnapshot.customer = {
    id: "cus_buyer",
    object: "customer",
    livemode: false,
    customer_account: "acct_buyer",
    unknown_field: true,
  };
  raw.providerSnapshot.subscription = {
    id: "sub_original",
    object: "subscription",
    deleted: false,
    customer: structuredClone(raw.providerSnapshot.customer),
    schedule: {
      id: raw.providerSnapshot.id,
      object: "subscription_schedule",
      subscription: "sub_original",
    },
  };
  expect((await construct(raw)).providerSnapshot).toEqual(raw.providerSnapshot);
});
it("does not accept an incoming C6 output as raw configuration", async () => {
  const raw: any = await input();
  raw.configuration = await sdk.projectRenewalConfigurationV2(
    raw.configuration,
  );
  await expect(construct(raw)).rejects.toThrow();
});
it("rejects hidden response metadata introduced by reflection during capture", async () => {
  const raw: any = await input(),
    body = raw.providerSnapshot;
  raw.providerSnapshot = new Proxy(body, {
    getPrototypeOf(target) {
      Object.defineProperty(target, "lastResponse", {
        enumerable: false,
        value: null,
      });
      return Object.prototype;
    },
  });
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  await expect(construct(raw)).rejects.toThrow();
  expect(digest).not.toHaveBeenCalled();
});
it("clones selected own-data fields without rereading a reflective raw root", async () => {
  const raw: any = await input();
  raw.providerSnapshot.selected_body = "first";
  const selected = structuredClone(raw.providerSnapshot),
    replacement = structuredClone(raw.providerSnapshot);
  replacement.selected_body = "replacement";
  Object.defineProperty(replacement, "lastResponse", {
    enumerable: false,
    value: { statusCode: 200 },
  });
  let swaps = 0;
  const wrapped = new Proxy(raw, {
    getPrototypeOf(target) {
      swaps++;
      target.providerSnapshot = replacement;
      return Object.prototype;
    },
  });
  const result = await construct(wrapped);
  expect(swaps).toBe(0);
  expect(result.providerSnapshot).toEqual(selected);
  expect(result.providerSnapshotBinding).toBe(
    digest("renewal-configured-baseline", selected),
  );
  expect(
    Object.prototype.hasOwnProperty.call(
      result.providerSnapshot,
      "lastResponse",
    ),
  ).toBe(false);
});
it.each(["symbol", "nonEnumerable", "accessor", "cycle", "sparse"])(
  "rejects invalid raw %s before hashing",
  async (kind) => {
    const raw: any = await input(),
      read = vi.fn();
    if (kind === "symbol") raw[Symbol("unexpected")] = true;
    else if (kind === "nonEnumerable")
      Object.defineProperty(raw.transport, "status", {
        value: 200,
        enumerable: false,
      });
    else if (kind === "accessor")
      Object.defineProperty(raw, "providerSnapshot", {
        enumerable: true,
        get: read,
      });
    else if (kind === "cycle")
      raw.providerSnapshot.circular = raw.providerSnapshot;
    else raw.providerSnapshot.future = new Array(1);
    const digest = vi.fn();
    vi.stubGlobal("crypto", { subtle: { digest } });
    await expect(construct(raw)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  },
);
it("exports only the named public constructor and types", async () => {
  const root = await import("../../index.js");
  expect(root).toHaveProperty(
    "constructRenewalConfigurationReceiptV2",
    sdk.constructRenewalConfigurationReceiptV2,
  );
  expect(root).not.toHaveProperty("captureConfigurationReceipt");
  expect(root).not.toHaveProperty("renewalBindingV2");
});
