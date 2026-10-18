import type { BetterStripe } from "@fantastic.dev/better-stripe";
import type {
  UsageAllowanceBinding,
  UsageLimitPolicy,
} from "@fantastic.dev/better-stripe/usage";
type AllowanceClient = Pick<
  BetterStripe["usage"],
  "getAllowanceStatus" | "configureAllowance"
>;
/** Setup can be retried after package policy persistence but before host snapshot persistence. */
export async function ensureDemoAllowance(
  ctx: Parameters<AllowanceClient["getAllowanceStatus"]>[0],
  usage: AllowanceClient,
  original: UsageAllowanceBinding,
): Promise<void> {
  const policy: UsageLimitPolicy = {
    reset: "billing_period",
    rollover: "none",
    entitled: true,
    overage: "allow",
    limit:
      original.binding.plan.model === "included_overage"
        ? { mode: "soft", quantity: "12" }
        : { mode: "none" },
  };
  const saved = await usage.getAllowanceStatus(ctx, original);
  if (!saved) {
    await usage.configureAllowance(ctx, {
      ...original,
      expectedRevision: 0,
      policy,
    });
    return;
  }
  if (JSON.stringify(saved.policy) !== JSON.stringify(policy))
    throw new Error(
      "Retain the original allowance policy while reconciling setup.",
    );
}
/** A native test clock cannot advance the Convex server's wall clock. */
export function demoRenewalActive(
  period: { start: number; end: number },
  now = Math.floor(Date.now() / 1000),
) {
  return now >= period.start && now < period.end;
}
