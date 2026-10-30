import { types } from "node:util";
import { rejectProxyJSON } from "../acquisition/rawWireSource.js";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { freeze } from "../material/nodeKernel.js";
import { need } from "./request.js";
import type { Diagnostics } from "../operations/providerFailure.js";
const responsePrototype = Response.prototype;
const statusGetter = Object.getOwnPropertyDescriptor(
  responsePrototype,
  "status",
)!.get!;

/** Owner gating is supplied by the actual pair before this DATA capture. */
export function captureConfigureReply(raw: unknown) {
  rejectProxyJSON(raw, true);
  need(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  const proto = Object.getPrototypeOf(raw);
  need(proto === Object.prototype || proto === null);
  const descriptor = Object.getOwnPropertyDescriptor(raw, "lastResponse");
  need(
    descriptor &&
      !descriptor.enumerable &&
      "value" in descriptor &&
      descriptor.value !== null &&
      typeof descriptor.value === "object" &&
      !types.isProxy(descriptor.value),
  );
  const meta: object = descriptor.value,
    codes: unknown[] = [];
  for (const key of ["status", "statusCode"]) {
    const d = Object.getOwnPropertyDescriptor(meta, key);
    if (d) {
      need("value" in d);
      if (d.value !== undefined) codes.push(d.value);
    }
  }
  if (Object.getPrototypeOf(meta) === responsePrototype)
    codes.push(Reflect.apply(statusGetter, meta, []));
  need(
    codes.length > 0 &&
      codes.every(
        (x) =>
          typeof x === "number" &&
          Number.isInteger(x) &&
          x >= 200 &&
          x < 300 &&
          x === codes[0],
      ),
  );
  const status = codes[0];
  need(typeof status === "number");
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(raw)) {
    need(typeof key === "string");
    if (key === "lastResponse") continue;
    const d = Object.getOwnPropertyDescriptor(raw, key);
    need(d && d.enumerable && "value" in d);
    entries.push([key, d.value]);
  }
  const body = requiredJSONSnapshot(Object.fromEntries(entries));
  need(body !== null && typeof body === "object" && !Array.isArray(body));
  const d = Object.getOwnPropertyDescriptor(meta, "requestId");
  let requestId: string | undefined;
  if (d) {
    need("value" in d);
    if (d.value !== undefined) {
      need(
        typeof d.value === "string" &&
          d.value.length >= 1 &&
          d.value.length <= 255,
      );
      requiredJSONSnapshot(d.value);
      requestId = d.value;
    }
  }
  return freeze({
    body: body as Record<string, unknown>,
    transport: { status, ...(requestId === undefined ? {} : { requestId }) },
  });
}
/** Read own DATA only after actual live catch. Unsafe optional diagnostics are omitted. */
export function configureDiagnostics(raw: unknown): Diagnostics {
  const result: {
    type?: string;
    code?: string;
    statusCode?: number;
    requestId?: string;
  } = {};
  if (raw === null || typeof raw !== "object" || types.isProxy(raw))
    return Object.freeze(result);
  for (const key of ["type", "code", "statusCode", "requestId"] as const) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !("value" in d)) continue;
    const value: unknown = d.value;
    if (key === "statusCode") {
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
      )
        result[key] = value;
    } else if (
      typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 255
    ) {
      try {
        requiredJSONSnapshot(value);
        result[key] = value;
      } catch {
        /* Unsafe diagnostics do not change actual catch identity. */
      }
    }
  }
  return Object.freeze(result);
}
