import { z } from "zod";
import { idempotencyOptions } from "../../core/idempotency.js";
import { binding, conflict, resourceId, timestamp } from "./shared.js";

const requestSchema = z
  .object({
    version: z.literal(1),
    stage: z.literal("attach"),
    scope: z.literal("platform"),
    apiVersion: z.string(),
    logicalBinding: z.string(),
    method: z.literal("POST"),
    path: z.literal("/v1/subscription_schedules"),
    payload: z.object({ from_subscription: resourceId("sub") }).strict(),
    key: z.string(),
    firstDispatchedAt: timestamp,
    requestIdentity: z
      .object({ key: z.string(), binding: z.string() })
      .strict(),
  })
  .strict();
const receiptSchema = z
  .object({
    version: z.literal(1),
    stage: z.literal("attached_unconfigured"),
    scope: z.literal("platform"),
    logicalBinding: z.string(),
    request: requestSchema,
    scheduleId: resourceId("sub_sched"),
    subscriptionId: resourceId("sub"),
    customerAccountId: resourceId("acct"),
    livemode: z.boolean(),
    providerSnapshot: z.unknown(),
    binding: z.string(),
  })
  .strict();

export function validateAttachReceipt(
  value: unknown,
  prepared: {
    requestIdentity: { binding: string };
    expected: {
      subscriptionId: string;
      customerAccountId: string;
      livemode: boolean;
    };
  },
  apiVersion: string,
  observedAt: number,
) {
  try {
    const receipt = receiptSchema.parse(value);
    const { requestIdentity, ...unsignedRequest } = receipt.request;
    const { binding: receivedBinding, ...unsignedReceipt } = receipt;
    const key = idempotencyOptions(receipt.request.key)?.idempotencyKey;
    if (
      !key ||
      requestIdentity.key !== key ||
      requestIdentity.binding !== binding("renewal-attach", unsignedRequest) ||
      receivedBinding !== binding("renewal-attach-receipt", unsignedReceipt) ||
      receipt.logicalBinding !== prepared.requestIdentity.binding ||
      receipt.request.logicalBinding !== prepared.requestIdentity.binding ||
      receipt.request.apiVersion !== apiVersion ||
      receipt.request.payload.from_subscription !==
        prepared.expected.subscriptionId ||
      receipt.subscriptionId !== prepared.expected.subscriptionId ||
      receipt.customerAccountId !== prepared.expected.customerAccountId ||
      receipt.livemode !== prepared.expected.livemode ||
      receipt.request.firstDispatchedAt > observedAt
    )
      conflict("invalid_attach_receipt_binding");
    return receipt;
  } catch {
    return conflict("invalid_attach_receipt_binding");
  }
}
