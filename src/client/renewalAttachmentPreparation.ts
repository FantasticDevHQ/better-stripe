import { canonicalJournalRecord } from "../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "./billing/renewalReplacementSnapshot.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  type PrepareRenewalPriceReplacementV2Options,
} from "./billing/renewalV2/index.js";
import { validateOwnedReadMaterial } from "./billing/renewalAttach/internal/material/readMaterial.js";
import {
  ATTACHMENT_API_VERSION,
  ATTACHMENT_END_MS,
  ATTACHMENT_WORK_MS,
  NODE_ATTACHMENT_PROFILE,
  supportsAttachmentProfile,
} from "./billing/renewalAttach/attachmentProfile.js";

export type PrepareRenewalAttachmentOperationOptions = {
  preparation: PrepareRenewalPriceReplacementV2Options;
  authorization: { scope: string; id: string; revision: number };
  logicalOperationId: string;
  attachKey: string;
  firstDispatchedAt: number;
};
/** Pure construction. The host authenticates consent before storing createArgs. */
export async function prepareRenewalAttachmentOperation(
  options: PrepareRenewalAttachmentOperationOptions,
) {
  const args = renewalSnapshot(options);
  const prepared = await prepareRenewalPriceReplacementV2(args.preparation);
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: ATTACHMENT_API_VERSION,
    attachKey: args.attachKey,
    firstDispatchedAt: args.firstDispatchedAt,
  });
  const subscription = prepared.providerSnapshot.subscription;
  const customer = prepared.providerSnapshot.billingCustomer;
  if (
    !customer ||
    !Array.isArray(subscription.discounts) ||
    subscription.discounts.length ||
    !Array.isArray(subscription.items.data[0].discounts) ||
    subscription.items.data[0].discounts.length
  )
    throw Error("UNSUPPORTED_RENEWAL_ATTACHMENT_PROFILE");
  const reads = validateOwnedReadMaterial(
    {
      apiVersion: ATTACHMENT_API_VERSION,
      observedAt: args.firstDispatchedAt,
      freshSubscription: subscription,
      targetPrice: prepared.providerSnapshot.targetPrice,
      billingCustomer: customer,
    },
    prepared,
    undefined,
    { subscription: [], item: [] },
    true,
  );
  if (
    !supportsAttachmentProfile({
      profile: reads.profile,
      livemode: prepared.expected.livemode,
      subscriptionDiscounts: reads.discounts,
      itemDiscounts: reads.itemDiscounts,
    })
  )
    throw Error("UNSUPPORTED_RENEWAL_ATTACHMENT_PROFILE");
  const record = {
    schemaVersion: 2,
    requestBinding: request.requestIdentity.binding,
    authorization: args.authorization,
    logicalOperationId: args.logicalOperationId,
    stage: "attach",
    account: { mode: "platform", stripeAccount: null, livemode: false },
    apiVersion: ATTACHMENT_API_VERSION,
    profile: NODE_ATTACHMENT_PROFILE,
    attachRequest: {
      preparation: args.preparation,
      apiVersion: ATTACHMENT_API_VERSION,
      attachKey: args.attachKey,
      firstDispatchedAt: args.firstDispatchedAt,
    },
    dispatch: {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    },
    originalBundle: {
      wireSubscription: args.preparation.subscription,
      wireTargetPrice: args.preparation.targetPrice,
      wireBillingCustomer: args.preparation.billingCustomer,
      couponReads: [],
      derivedCouponJoins: { subscription: [], item: [] },
    },
    timingPolicy: {
      version: 1,
      firstDispatchedAt: args.firstDispatchedAt,
      periodStart: prepared.expected.periodStart,
      periodEnd: prepared.expected.periodEnd,
      workEndWallMs: args.firstDispatchedAt * 1000 + ATTACHMENT_WORK_MS,
      endWallMs: args.firstDispatchedAt * 1000 + ATTACHMENT_END_MS,
    },
  };
  const full = canonicalJournalRecord(JSON.stringify(record));
  return {
    requestBinding: full.requestBinding,
    createArgs: {
      authorizationScope: full.authorizationScope,
      authorizationRevision: full.authorizationRevision,
      logicalOperationId: full.logicalOperationId,
      recordJSON: full.json,
    },
  };
}
