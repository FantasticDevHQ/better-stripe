type Existing = {
  metadata?: unknown;
  refundCommandKey?: string;
  refundCommandConflict?: boolean;
  refundCommandObservedAt?: number;
};
function keyFrom(metadata: unknown) {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  )
    return { kind: "missing" as const };
  const key = (metadata as Record<string, unknown>).betterStripeRefundCommand;
  if (key === undefined) return { kind: "missing" as const };
  return typeof key === "string" && /^[A-Za-z0-9:_-]{16,200}$/.test(key)
    ? { kind: "valid" as const, key }
    : { kind: "invalid" as const };
}

/** First known metadata is observed before incoming changes; it is not provider-creation provenance. */
export function refundCommandBinding(
  existing: Existing | null,
  incoming: { metadata?: unknown },
  now: number,
) {
  const old = keyFrom(existing?.metadata);
  const next = Object.prototype.hasOwnProperty.call(incoming, "metadata")
    ? keyFrom(incoming.metadata)
    : undefined;
  const first =
    existing?.refundCommandKey ?? (old.kind === "valid" ? old.key : undefined);
  const key = first ?? (next?.kind === "valid" ? next.key : undefined);
  const conflict =
    existing?.refundCommandConflict === true ||
    old.kind === "invalid" ||
    next?.kind === "invalid" ||
    (existing?.refundCommandKey !== undefined &&
      old.kind === "valid" &&
      old.key !== existing.refundCommandKey) ||
    (first !== undefined &&
      next !== undefined &&
      (next.kind !== "valid" || next.key !== first));
  return {
    refundCommandNormalizationVersion: 1 as const,
    refundCommandConflict: conflict,
    ...(key
      ? {
          refundCommandKey: key,
          refundCommandObservedAt: existing?.refundCommandObservedAt ?? now,
        }
      : {}),
  };
}
