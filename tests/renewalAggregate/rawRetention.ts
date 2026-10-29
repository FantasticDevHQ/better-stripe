import { createHash } from "node:crypto";
import { fixture } from "./fixtures.js";
import { renewalSnapshot } from "../../src/client/billing/renewalReplacementSnapshot.js";

export const canonical = (v: unknown) => JSON.stringify(renewalSnapshot(v));
export const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v), "utf8").digest("hex");
export const binding = (family: string, value: unknown) =>
  `${family}:v2:sha256:${hash(["betterstripe-renewal-binding", 2, family, value])}`;
export const own = (body: any, key: string, value: unknown) =>
  Object.defineProperty(body, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
export function input() {
  const f = fixture();
  return {
    subscription: structuredClone(f.subscription),
    targetPrice: structuredClone(f.targetPrice),
    billingCustomer: structuredClone(f.billingCustomer),
    expected: structuredClone(f.prepared.expected),
    key: f.prepared.requestIdentity.key,
  };
}
export function expandedInput(): any {
  const p: any = input();
  const item = p.subscription.items.data[0];
  item.price.product = {
    id: p.expected.currentProductId,
    object: "product",
    deleted: false,
  };
  p.targetPrice.product = {
    id: p.expected.targetProductId,
    object: "product",
    deleted: false,
  };
  p.billingCustomer.discount = {
    id: "di_customer",
    object: "discount",
    deleted: false,
  };
  return p;
}
export function configuration(preparation: any = input()): any {
  const f = fixture(),
    a = f.attachRequest;
  return {
    preparation,
    attachReceipt: {
      attachRequest: {
        preparation: structuredClone(preparation),
        apiVersion: a.apiVersion,
        attachKey: a.key,
        firstDispatchedAt: a.firstDispatchedAt,
      },
      actualDispatch: {
        scope: "platform",
        apiVersion: a.apiVersion,
        method: "POST",
        path: "/v1/subscription_schedules",
        payload: a.payload,
        key: a.key,
        firstDispatchedAt: a.firstDispatchedAt,
      },
      providerSnapshot: structuredClone(f.schedule),
    },
    freshSubscription: {
      ...structuredClone(preparation.subscription),
      schedule: f.schedule.id,
    },
    targetPrice: structuredClone(preparation.targetPrice),
    billingCustomer: structuredClone(preparation.billingCustomer),
    schedule: structuredClone(f.schedule),
    apiVersion: a.apiVersion,
    observedAt: f.configureInput.observedAt,
    firstDispatchedAt: f.configureInput.firstDispatchedAt,
    configureKey: f.configureInput.configureKey,
  };
}
export const paths: (string | number)[][] = [
  ["subscription"],
  ["subscription", "items"],
  ["subscription", "items", "data", 0],
  ["subscription", "items", "data", 0, "price"],
  ["subscription", "items", "data", 0, "price", "recurring"],
  ["subscription", "items", "data", 0, "price", "product"],
  ["targetPrice"],
  ["targetPrice", "recurring"],
  ["targetPrice", "product"],
  ["billingCustomer"],
  ["billingCustomer", "discount"],
];
export const at = (root: any, path: (string | number)[]) =>
  path.reduce((v, k) => v[k], root);
export function bound(p: any) {
  const {
    status: _status,
    preservation: _preservation,
    requestIdentity: _requestIdentity,
    ...v
  } = p;
  return v;
}

export const owns = (value: unknown, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
