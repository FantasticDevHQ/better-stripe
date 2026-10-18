import { z } from "zod";
import { componentRef, type WebhookContext } from "./helpers.js";
import type { V2ThinEvent } from "../types.js";
const types = [
  "v1.billing.meter.error_report_triggered",
  "v1.billing.meter.no_meter_found",
] as const;
export const isMeterErrorEvent = (type: string) =>
  types.some((value) => value === type);
const codes = new Set([
  "meter_event_customer_not_found",
  "meter_event_no_customer_defined",
  "meter_event_dimension_count_too_high",
  "archived_meter",
  "timestamp_too_far_in_past",
  "timestamp_in_future",
  "meter_event_value_not_found",
  "meter_event_invalid_value",
  "no_meter",
]);
const reportSchema = z.object({
  id: z.string(),
  type: z.enum(types),
  livemode: z.boolean(),
  related_object: z.object({ id: z.string().optional() }).nullish(),
  data: z.object({
    reason: z.object({
      error_types: z
        .array(
          z.object({
            code: z.string(),
            sample_errors: z
              .array(
                z.object({
                  request: z
                    .object({
                      identifier: z.string().optional(),
                      idempotency_key: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          }),
        )
        .max(1000),
    }),
  }),
});
async function processMeterErrorEvent(
  whCtx: WebhookContext,
  thin: V2ThinEvent,
): Promise<void> {
  const { stripe, ctx, component } = whCtx;
  const [raw, account, balance] = await Promise.all([
    stripe.v2.core.events.retrieve(thin.id),
    stripe.accounts.retrieve(null),
    stripe.balance.retrieve(),
  ]);
  const parsed = reportSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.id !== thin.id ||
    parsed.data.type !== thin.type ||
    parsed.data.livemode !== balance.livemode ||
    thin.livemode !== balance.livemode ||
    (thin.context && thin.context !== account.id)
  )
    throw new Error("Native usage error report scope unavailable");
  const report = parsed.data,
    samples: Array<{ identifier: string; code: string }> = [];
  let truncated = false;
  for (const type of report.data.reason.error_types) {
    if (!codes.has(type.code)) {
      truncated = true;
      continue;
    }
    for (const error of type.sample_errors ?? []) {
      const identifier =
        error.request?.identifier ?? error.request?.idempotency_key;
      if (
        !identifier ||
        !/^bs_usage_[a-zA-Z0-9_]+$/.test(identifier) ||
        identifier.length > 100
      ) {
        truncated = true;
        continue;
      }
      if (samples.length >= 100) {
        truncated = true;
        break;
      }
      samples.push({ identifier, code: type.code });
    }
  }
  await ctx.runMutation(
    componentRef(component, "usageDelivery/mutations/recordErrorReport"),
    {
      stripeAccountId: account.id,
      livemode: report.livemode,
      providerEventId: report.id,
      meterId: report.related_object?.id,
      samples,
      truncated,
    },
  );
}

export async function handleMeterErrorEvent(
  whCtx: WebhookContext,
  thin: V2ThinEvent,
): Promise<void> {
  try {
    await processMeterErrorEvent(whCtx, thin);
  } catch {
    throw new Error("Native usage error report unavailable");
  }
}
