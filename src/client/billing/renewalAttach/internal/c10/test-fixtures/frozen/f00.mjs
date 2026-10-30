import { z } from "zod";
import { object, timestamp, unsupported } from "./f02.mjs";
const mode = z
  .object({
    type: z.enum(["classic", "flexible"]),
    flexible: z
      .object({
        proration_discounts: z.enum(["included", "itemized"]).optional(),
      })
      .strict()
      .nullable(),
    updated_at: timestamp.optional(),
  })
  .strict()
  .refine((value) => value.type !== "classic" || value.flexible === null);
const anchorConfig = z
  .object({
    day_of_month: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12).nullable(),
    hour: z.number().int().min(0).max(23).nullable(),
    minute: z.number().int().min(0).max(59).nullable(),
    second: z.number().int().min(0).max(59).nullable(),
  })
  .strict()
  .nullable();
export function profileOf(subscription, currentPrice, targetPrice, apiVersion) {
  const parsedMode = mode.safeParse(subscription.billing_mode);
  if (!parsedMode.success) unsupported("unsupported_billing_mode");
  const parsedConfig = anchorConfig.safeParse(
    subscription.billing_cycle_anchor_config,
  );
  if (!parsedConfig.success) unsupported("unsupported_anchor_config");
  const anchor = timestamp.safeParse(subscription.billing_cycle_anchor);
  if (
    !anchor.success ||
    !Number.isFinite(new Date(anchor.data * 1000).getTime())
  )
    unsupported("unsupported_numeric_anchor");
  const current = object(object(currentPrice).recurring);
  const target = object(object(targetPrice).recurring);
  const cadence =
    current.interval === target.interval &&
    current.interval_count === target.interval_count
      ? "same"
      : "changed";
  if (parsedConfig.data !== null) {
    if (current.interval !== "month" && current.interval !== "year")
      unsupported("unsupported_anchor_config_cadence");
    if (cadence === "changed")
      unsupported("unsupported_changed_cadence_anchor_config");
  }
  const calendar = current.interval === "month" || current.interval === "year";
  const edge =
    calendar &&
    (new Date(anchor.data * 1000).getUTCDate() >= 29 ||
      (parsedConfig.data?.day_of_month ?? 0) >= 29);
  return {
    apiVersion,
    billingMode: parsedMode.data.type,
    cadence,
    anchor: edge ? "calendar_edge" : "ordinary",
  };
}
