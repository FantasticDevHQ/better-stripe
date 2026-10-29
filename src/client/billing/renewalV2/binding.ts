import { renewalSnapshot } from "../renewalReplacementSnapshot.js";

/** Internal fixed-family encoding. This is consistency, not authorization. */
export async function renewalBindingV2(
  family: "renewal" | "renewal-attach" | "renewal-attach-receipt",
  preimage: unknown,
): Promise<string> {
  // Finish all input capture and canonical bytes before the first await.
  const text = JSON.stringify(
    renewalSnapshot(["betterstripe-renewal-binding", 2, family, preimage]),
  );
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > 500_000)
    throw new Error("Renewal V2 binding exceeds its UTF-8 preimage budget.");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function")
    throw new Error("Renewal V2 requires Web Crypto SHA-256.");
  const digest = await subtle.digest("SHA-256", bytes);
  if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32)
    throw new Error("Renewal V2 received an invalid SHA-256 result.");
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${family}:v2:sha256:${hex}`;
}
