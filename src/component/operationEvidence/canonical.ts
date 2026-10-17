import { convexToJson, type Value } from "convex/values";

/** Convex encoding preserves special floats and recursively sorts object keys. */
export async function canonicalFingerprint(value: Value) {
  const bytes = new TextEncoder().encode(JSON.stringify(convexToJson(value)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
