import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";

export type Diagnostics = Readonly<{
  statusCode?: number;
  code?: string;
  requestId?: string;
  type?: string;
}>;
export function safeDiagnostics(error: unknown): Diagnostics {
  const result: {
    statusCode?: number;
    code?: string;
    requestId?: string;
    type?: string;
  } = {};
  if (!error || typeof error !== "object" || types.isProxy(error))
    return Object.freeze(result);
  for (const key of ["statusCode", "code", "requestId", "type"] as const) {
    const d = Object.getOwnPropertyDescriptor(error, key);
    if (!d || !("value" in d)) continue;
    const value: unknown = d.value;
    if (key === "statusCode") {
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 100 &&
        value <= 599
      )
        result[key] = value;
      continue;
    }
    if (key === "code") {
      if (
        typeof value === "string" &&
        ["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(value)
      )
        result[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 255)
      try {
        requiredJSONSnapshot(value);
        result[key] = value;
      } catch {
        /* Unsafe details are omitted, not reclassified. */
      }
  }
  return Object.freeze(result);
}

/** The opaque value is not recursively frozen, copied, serialized or reflected. */
export function opaqueRecord<T extends object>(
  fields: T,
  key: string,
  value: unknown,
): Readonly<T> {
  const record = { ...fields };
  Object.defineProperty(record, key, {
    value,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(record);
}
