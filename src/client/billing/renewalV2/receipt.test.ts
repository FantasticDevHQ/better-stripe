import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import * as v2 from "./index.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { fixture } from "../../../../tests/renewalAggregate/fixtures.js";

const construct = (raw: any) =>
  v2.constructRenewalScheduleAttachmentReceiptV2(raw);
function input() {
  const f = fixture();
  const preparation = {
    subscription: f.subscription,
    targetPrice: f.targetPrice,
    billingCustomer: f.billingCustomer,
    expected: f.prepared.expected,
    key: f.prepared.requestIdentity.key,
  };
  return {
    attachRequest: {
      preparation,
      apiVersion: f.attachRequest.apiVersion,
      attachKey: f.attachRequest.key,
      firstDispatchedAt: f.attachRequest.firstDispatchedAt,
    },
    actualDispatch: {
      scope: "platform" as const,
      apiVersion: f.attachRequest.apiVersion,
      method: "POST" as const,
      path: "/v1/subscription_schedules" as const,
      payload: { from_subscription: preparation.expected.subscriptionId },
      key: f.attachRequest.key,
      firstDispatchedAt: f.attachRequest.firstDispatchedAt,
    },
    providerSnapshot: f.schedule,
  };
}
afterEach(() => vi.unstubAllGlobals());
it("constructs the complete unsigned C3 receipt through the public barrel", async () => {
  expect(v2.constructRenewalScheduleAttachmentReceiptV2).toBeTypeOf("function");
  const raw = input();
  const options: v2.ConstructRenewalScheduleAttachmentReceiptV2Options = raw;
  const receipt = await v2.constructRenewalScheduleAttachmentReceiptV2(options);
  const typed: v2.RenewalScheduleAttachmentReceiptV2 = receipt;
  expect(typed.version).toBe(2);
  const prepared = await v2.prepareRenewalPriceReplacementV2(
    raw.attachRequest.preparation,
  );
  const { preparation: _preparation, ...requestOptions } = raw.attachRequest;
  const request = await v2.prepareRenewalScheduleAttachmentV2({
    ...requestOptions,
    prepared,
  });
  const unsigned = {
    version: 2,
    stage: "attached_unconfigured",
    scope: "platform",
    logicalBinding: prepared.requestIdentity.binding,
    request,
    scheduleId: raw.providerSnapshot.id,
    subscriptionId: prepared.expected.subscriptionId,
    customerAccountId: prepared.expected.customerAccountId,
    livemode: prepared.expected.livemode,
    providerSnapshot: raw.providerSnapshot,
  };
  const bytes = JSON.stringify(
    renewalSnapshot([
      "betterstripe-renewal-binding",
      2,
      "renewal-attach-receipt",
      unsigned,
    ]),
  );
  expect(receipt).toEqual({
    ...unsigned,
    binding: `renewal-attach-receipt:v2:sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`,
  });
  const sdk = await import("../../index.js");
  expect(sdk).toHaveProperty(
    "constructRenewalScheduleAttachmentReceiptV2",
    v2.constructRenewalScheduleAttachmentReceiptV2,
  );
  expect(receipt).not.toHaveProperty("transport");
  expect(receipt).not.toHaveProperty("observedAt");
});

it.each([
  "scope",
  "apiVersion",
  "method",
  "path",
  "payload",
  "key",
  "firstDispatchedAt",
])("rejects changed actual dispatch %s", async (field) => {
  const raw: any = input();
  raw.actualDispatch[field] =
    field === "payload"
      ? { from_subscription: "sub_foreign" }
      : field === "firstDispatchedAt"
        ? raw.actualDispatch[field] + 1
        : "changed";
  await expect(construct(raw)).rejects.toThrow();
});
it("binds complete unknown provider material without claiming response authority", async () => {
  const a: any = input(),
    b: any = input();
  b.providerSnapshot.future_native_field = { untouched: [null, "safe"] };
  const first = await construct(a),
    second = await construct(b);
  expect(second.providerSnapshot).toEqual(b.providerSnapshot);
  expect(second.binding).not.toBe(first.binding);
  expect(second).not.toHaveProperty("authenticationEstablished");
  expect(second).not.toHaveProperty("providerQualification");
});
it("preserves own JSON keys that record parsers may otherwise discard", async () => {
  const raw: any = input();
  Object.defineProperty(raw.providerSnapshot, "__proto__", {
    value: { retained: true },
    enumerable: true,
  });
  const result = await construct(raw);
  expect(
    Object.prototype.hasOwnProperty.call(result.providerSnapshot, "__proto__"),
  ).toBe(true);
  expect(result.providerSnapshot).toEqual(
    JSON.parse(JSON.stringify(raw.providerSnapshot)),
  );
});
it("accepts matching expanded identity relations without dropping fields", async () => {
  const raw: any = input();
  raw.providerSnapshot.customer = {
    id: "cus_buyer",
    object: "customer",
    livemode: false,
    customer_account: "acct_buyer",
    future_field: "preserve",
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
  const result = await construct(raw);
  expect(result.providerSnapshot).toEqual(raw.providerSnapshot);
});
it("rejects stored preparations and does not convert V1 receipt records", async () => {
  const raw: any = input();
  raw.attachRequest.preparation = fixture().prepared;
  await expect(construct(raw)).rejects.toThrow();
  await expect(construct(fixture().attachReceipt)).rejects.toThrow();
});
it("rejects extra payload fields and required accessors before digest", async () => {
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  const raw: any = input();
  raw.actualDispatch.payload.extra = "unexpected";
  await expect(construct(raw)).rejects.toThrow();
  delete raw.actualDispatch.payload.extra;
  const read = vi.fn();
  Object.defineProperty(raw, "providerSnapshot", {
    enumerable: true,
    get: read,
  });
  await expect(construct(raw)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(digest).not.toHaveBeenCalled();
});
it.each([
  "customer",
  "subscription",
  "mode",
  "account",
  "deleted",
  "missingBillingCustomer",
])("rejects wrong or missing identity %s", async (field) => {
  const raw: any = input();
  if (field === "mode") raw.providerSnapshot.livemode = true;
  else if (field === "account")
    raw.providerSnapshot.customer_account = "acct_other";
  else if (field === "deleted") raw.providerSnapshot.deleted = true;
  else if (field === "missingBillingCustomer")
    delete raw.attachRequest.preparation.billingCustomer;
  else
    raw.providerSnapshot[field] =
      field === "customer" ? "cus_foreign" : "sub_foreign";
  await expect(construct(raw)).rejects.toThrow();
});
it("checks expanded identity relations and preserves opaque fields", async () => {
  const raw: any = input();
  raw.providerSnapshot.subscription = {
    id: "sub_original",
    object: "subscription",
    schedule: {
      id: raw.providerSnapshot.id,
      object: "subscription_schedule",
      customer: "cus_foreign",
    },
  };
  await expect(construct(raw)).rejects.toThrow();
});
it.each(["root", "attachRequest", "preparation", "actualDispatch"])(
  "rejects unknown %s names before reading them",
  async (field) => {
    const raw: any = input(),
      target =
        field === "root"
          ? raw
          : field === "preparation"
            ? raw.attachRequest.preparation
            : raw[field];
    const read = vi.fn(() => "ignored");
    Object.defineProperty(target, "unexpected", {
      enumerable: true,
      get: read,
    });
    await expect(construct(raw)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  },
);
it("rechecks captured required fields before digest after a Proxy mutation", async () => {
  const raw: any = input(),
    request = raw.attachRequest;
  raw.attachRequest = new Proxy(request, {
    getPrototypeOf(target) {
      delete target.apiVersion;
      return Object.prototype;
    },
  });
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  await expect(construct(raw)).rejects.toThrow();
  expect(digest).not.toHaveBeenCalled();
});
it("captures the whole raw leaf before awaiting digest", async () => {
  const raw: any = input();
  const original = structuredClone(raw.providerSnapshot);
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
  raw.actualDispatch.key = "changed";
  release();
  const result = await pending;
  expect(result.providerSnapshot).toEqual(original);
});
it.each(["unavailable", "rejected", "invalid"])(
  "fails when digest is %s without fallback",
  async (kind) => {
    vi.stubGlobal(
      "crypto",
      kind === "unavailable"
        ? {}
        : {
            subtle: {
              digest:
                kind === "rejected"
                  ? () => Promise.reject(Error("failed"))
                  : () => Promise.resolve(new ArrayBuffer(1)),
            },
          },
    );
    await expect(construct(input())).rejects.toThrow();
  },
);
it("enforces the whole UTF-8 receipt preimage budget", async () => {
  const raw: any = input();
  raw.providerSnapshot.large_unknown = "\u0800".repeat(180000);
  await expect(construct(raw)).rejects.toThrow();
});
