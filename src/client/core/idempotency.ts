import { throwStripeError } from "../errors.js";
/** Explicit request identity. Omission preserves the SDK's existing behavior. */
export function idempotencyOptions(key: string | undefined) {
  if (key === undefined) return undefined;
  if (
    typeof key !== "string" ||
    !key.trim() ||
    key.length > 255 ||
    /[\r\n]/.test(key)
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Idempotency keys must be nonempty, at most 255 characters, and contain no line breaks.",
    );
  return { idempotencyKey: key };
}
