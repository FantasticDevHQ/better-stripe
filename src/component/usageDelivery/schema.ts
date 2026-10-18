import { v } from "convex/values";
import { scopeValidator, deliveryValidator } from "../usage/schema.js";
import { errorCode, reason } from "./fields.js";
export const refFields = {
  scope: scopeValidator,
  eventId: v.id("usageEvents"),
};
export const status = v.object({
  validationErrors: v.array(
    v.object({
      providerEventId: v.string(),
      code: errorCode,
      observedAt: v.number(),
    }),
  ),
  validationHistoryComplete: v.boolean(),
  eventId: v.id("usageEvents"),
  state: deliveryValidator,
  attempts: v.number(),
  held: v.boolean(),
  reason: v.optional(reason),
  providerIdentifier: v.string(),
  receipt: v.optional(
    v.object({ identifier: v.string(), created: v.number() }),
  ),
});
export const request = {
  ...refFields,
  attempt: v.number(),
  definitionVersion: v.literal(1),
  apiVersion: v.string(),
  identifier: v.string(),
};
