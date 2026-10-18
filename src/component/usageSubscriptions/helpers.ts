import { convexToJson } from "convex/values";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import {
  subscriptionScope,
  subscriptionScopeSchema,
  subscriptionTerms,
} from "../../client/usage/subscriptionTerms.js";
export function jsonTerms(json: string) {
  if (new TextEncoder().encode(json).length > 32768)
    throw new Error("Subscription terms exceed size limit");
  const terms = subscriptionTerms(JSON.parse(json));
  return {
    terms,
    termsJson: JSON.stringify(convexToJson(terms)),
    scopeKey: JSON.stringify(subscriptionScope(terms)),
  };
}
export async function intentKey(scope: unknown, requestId: string) {
  if (!requestId || requestId.length > 100)
    throw new Error("Invalid subscription request identity");
  return canonicalFingerprint([
    subscriptionScopeSchema.parse(scope),
    requestId,
  ]);
}
export function observationStart(startedAt: number) {
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0 ||
    startedAt > Date.now() + 300000
  )
    throw new Error("Invalid subscription observation time");
}
