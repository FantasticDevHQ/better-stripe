import type { FundingPhaseRef } from "./workflowValidators.js";
import type { ProvisioningReceipt } from "./workflowSchema.js";
/** Allowlist only bound, nonsecret provider evidence before durable journaling. */
export function normalizeReceipt(
  value: unknown,
  args: FundingPhaseRef,
): ProvisioningReceipt | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (
    r.phase !== args.phase ||
    r.customerAccount !== args.accountId ||
    r.stripeSubscriptionId !== args.stripeSubscriptionId ||
    r.providerApiVersion !== args.providerApiVersion ||
    (r.paymentMethodId !== null &&
      (typeof r.paymentMethodId !== "string" ||
        !r.paymentMethodId.trim() ||
        r.paymentMethodId.length > 200)) ||
    (args.phase !== "apply" && r.paymentMethodId === null)
  )
    return null;
  if (
    args.phase === "apply" &&
    (typeof r.enabled !== "boolean" ||
      !(
        r.paymentMethodTypes === null ||
        (Array.isArray(r.paymentMethodTypes) &&
          r.paymentMethodTypes.length <= 50 &&
          r.paymentMethodTypes.every(
            (x) => typeof x === "string" && x.length <= 200,
          ))
      ))
  )
    return null;
  return {
    phase: args.phase,
    customerAccount: args.accountId,
    stripeSubscriptionId: args.stripeSubscriptionId,
    providerApiVersion: args.providerApiVersion,
    paymentMethodId: r.paymentMethodId as string | null,
    ...(args.phase === "apply"
      ? {
          enabled: r.enabled as boolean,
          paymentMethodTypes: r.paymentMethodTypes as string[] | null,
        }
      : {}),
  };
}
