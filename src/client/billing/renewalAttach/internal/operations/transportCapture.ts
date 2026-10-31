import { types } from "node:util";
import { OWNER } from "../originalOwner.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import {
  closed,
  captureRequestAndReads,
  need,
  type SourceMethod,
} from "./types.js";

function sourceFunction(
  service: unknown,
  name: string,
): { receiver: object; method: SourceMethod } {
  need(service && typeof service === "object" && !types.isProxy(service));
  const d = Object.getOwnPropertyDescriptor(service, name);
  need(d && "value" in d && typeof d.value === "function");
  // The function is selected once from validated own data, preserving its receiver.
  return { receiver: service, method: d.value as SourceMethod };
}

/** Internal fixed attach profile: 43 reads and one POST, never a 44-GET profile. */
function captureSource(raw: unknown, expectedOwner: typeof OWNER) {
  const b = closed(raw, ["owner", "request", "readPlan", "delegate"]);
  need(b.owner === expectedOwner);
  const owner = sourceFunction(b.owner, "check"),
    delegate = sourceFunction(b.delegate, "rawRequest");
  const { request, plan } = captureRequestAndReads(b.request, b.readPlan);
  return Object.freeze({
    owner: owner.receiver,
    check: owner.method,
    delegate: delegate.receiver,
    send: delegate.method,
    request,
    plan: Object.freeze(plan),
  });
}

export function captureLegacyTransportSource(raw: unknown) {
  return captureSource(raw, OWNER);
}
export function captureInitialTransportSource(token: object, raw: unknown) {
  return captureSource(raw, ownerForInitialLineage(token));
}

export function checkTransportOwnerResult(value: unknown) {
  const x = closed(value, ["wallMs", "ns", "nowSeconds", "retired"]);
  need(
    typeof x.wallMs === "number" &&
      Number.isSafeInteger(x.wallMs) &&
      x.wallMs >= 0 &&
      typeof x.ns === "bigint" &&
      x.ns >= 0n &&
      x.ns <= 18446744073709551615n &&
      typeof x.nowSeconds === "number" &&
      Number.isSafeInteger(x.nowSeconds) &&
      x.nowSeconds === Math.floor(x.wallMs / 1000) &&
      x.retired === false,
  );
}
