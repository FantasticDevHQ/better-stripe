import { z } from "zod";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import {
  observationOptions,
  type UsageObservationOptions,
} from "../../client/usage/observationTypes.js";
import { scopeKey } from "../usage/helpers.js";
import { decimalFromScaled } from "../../client/usage/summary.js";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const period = z.strictObject({ start: integer, end: integer });
const scaled = z.string().regex(/^\d{1,30}$/),
  quantity = z.string().regex(/^\d{1,30}(\.\d{1,6})?$/);
const value = z.strictObject({
  period,
  quantity,
  scaledQuantity: scaled,
  complete: z.boolean(),
  nextCursor: z.string().max(2048).nullable(),
  aggregationLagPossible: z.literal(true),
  stale: z.literal(false),
  entries: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(2048),
        start: integer,
        end: integer,
        scaledQuantity: scaled,
      }),
    )
    .max(100),
});
const availability = z.union([
  z.strictObject({
    status: z.literal("available"),
    observedAt: integer,
    value,
  }),
  z.strictObject({
    status: z.enum(["unavailable", "unsupported"]),
    reason: z.enum([
      "minute_alignment_required",
      "provider_binding_mismatch",
      "unsupported_scope",
      "aggregation_pending",
      "provider_history_incomplete",
      "provider_precision_unsupported",
      "provider_unavailable",
    ]),
    retryable: z.boolean(),
  }),
]);
export async function source(json: string) {
  if (new TextEncoder().encode(json).length > 8192)
    throw new Error("Usage observation source exceeds limit");
  const opts = observationOptions(JSON.parse(json) as UsageObservationOptions);
  const sourceJson = JSON.stringify(opts);
  return {
    opts,
    sourceJson,
    scopeKey: scopeKey(opts.scope),
    key: await canonicalFingerprint(opts),
  };
}
export function observation(
  json: string,
  opts: ReturnType<typeof observationOptions>,
) {
  if (new TextEncoder().encode(json).length > 65536)
    throw new Error("Invalid usage provider observation");
  const parsed = availability.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error("Invalid usage provider observation");
  const result = parsed.data;
  if (result.status === "available") {
    const v = result.value;
    if (
      result.observedAt > Date.now() / 1000 + 300 ||
      JSON.stringify(v.period) !== JSON.stringify(opts.period) ||
      v.quantity !==
        decimalFromScaled(
          BigInt(v.scaledQuantity),
          opts.binding.plan.unit.precision,
        ) ||
      v.entries.reduce((sum, e) => sum + BigInt(e.scaledQuantity), 0n) !==
        BigInt(v.scaledQuantity) ||
      v.entries.some(
        (e) =>
          e.start < opts.period.start ||
          e.end > opts.period.end ||
          e.end <= e.start,
      )
    )
      throw new Error("Invalid usage provider observation");
  }
  return JSON.stringify(result);
}
