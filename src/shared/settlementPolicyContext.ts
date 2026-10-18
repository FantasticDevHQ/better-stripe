/** Nonsecret host provenance. The SDK never interprets this as authorization. */
export type SettlementPolicyContext = Readonly<{
  namespace: string;
  version: 1;
  fields: Readonly<Record<string, string>>;
}>;

/** Canonical, bounded binding shared by SDK entry and component reservation. */
export function policyContextBinding(
  context?: SettlementPolicyContext,
): string {
  if (context === undefined) return "absent";
  if (
    !context ||
    typeof context !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context)) ||
    Object.keys(context).some(
      (key) => !["namespace", "version", "fields"].includes(key),
    ) ||
    typeof context.namespace !== "string" ||
    context.namespace.length < 1 ||
    context.namespace.length > 80 ||
    context.version !== 1 ||
    !context.fields ||
    typeof context.fields !== "object" ||
    Array.isArray(context.fields) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context.fields))
  )
    throw new Error("Invalid settlement policy context.");
  const entries = Object.entries(context.fields).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (
    entries.length > 32 ||
    entries.some(
      ([key, value]) =>
        key.length < 1 ||
        key.length > 64 ||
        key.startsWith("$") ||
        !/^[ -~]+$/.test(key) ||
        typeof value !== "string" ||
        value.length > 512,
    )
  )
    throw new Error("Invalid settlement policy context fields.");
  const binding = JSON.stringify({
    namespace: context.namespace,
    version: context.version,
    fields: Object.fromEntries(entries),
  });
  if (new TextEncoder().encode(binding).byteLength > 8192)
    throw new Error("Settlement policy context exceeds 8 KiB.");
  return binding;
}

export function assertPolicyContextMatches(
  saved: SettlementPolicyContext | undefined,
  requested: SettlementPolicyContext | undefined,
) {
  if (policyContextBinding(saved) !== policyContextBinding(requested))
    throw new Error("Settlement policy context cannot change.");
}
