import type { RenewalProfile } from "../renewalAggregate/profile.js";
export const NODE_ATTACHMENT_PROFILE = "node-endive-attach-v1";
export const ATTACHMENT_API_VERSION = "2026-09-30.endive";
export const ATTACHMENT_WORK_MS = 30_000;
export const ATTACHMENT_END_MS = 35_000;
/** The first public attachment profile deliberately excludes inherited discounts. */
export function supportsAttachmentProfile(input: {
  profile: RenewalProfile;
  livemode: boolean;
  subscriptionDiscounts: readonly unknown[];
  itemDiscounts: readonly unknown[];
}) {
  return (
    input.profile.apiVersion === ATTACHMENT_API_VERSION &&
    input.profile.billingMode === "classic" &&
    input.profile.cadence === "same" &&
    input.profile.anchor === "ordinary" &&
    input.livemode === false &&
    input.subscriptionDiscounts.length === 0 &&
    input.itemDiscounts.length === 0
  );
}
