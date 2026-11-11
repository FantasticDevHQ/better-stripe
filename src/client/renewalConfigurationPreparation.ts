import { canonicalJournalRecord } from "../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "./billing/renewalReplacementSnapshot.js";
import { projectRenewalConfigurationV2 } from "./billing/renewalV2/index.js";
/** Pure candidate construction. Journal DATA never recreates live invocation authority. */
export async function prepareRenewalConfigurationOperation(options: {
  attachment: {
    operationId: string;
    attemptId: string;
    sourcePayloadId: string;
    recordJSON: string;
    receiptJSON: string;
  };
  authorization: { scope: string; id: string; revision: number };
  logicalOperationId: string;
  configureKey: string;
  firstDispatchedAt: number;
}) {
  const args = renewalSnapshot(options);
  const parent = JSON.parse(
    canonicalJournalRecord(args.attachment.recordJSON).json,
  );
  if (parent.stage !== "attach" || parent.profile !== "node-endive-attach-v1")
    throw Error("UNSUPPORTED_RENEWAL_CONFIGURATION_PARENT");
  const receipt = JSON.parse(args.attachment.receiptJSON);
  const configuration = {
    executionProfile: "node-endive-configure-v1" as const,
    preparation: parent.attachRequest.preparation,
    attachReceipt: {
      attachRequest: parent.attachRequest,
      actualDispatch: parent.dispatch,
      providerSnapshot: receipt.providerSnapshot,
    },
    freshSubscription: {
      ...parent.originalBundle.wireSubscription,
      schedule: receipt.scheduleId,
    },
    targetPrice: parent.originalBundle.wireTargetPrice,
    billingCustomer: parent.originalBundle.wireBillingCustomer,
    schedule: receipt.providerSnapshot,
    apiVersion: parent.apiVersion,
    observedAt: args.firstDispatchedAt,
    firstDispatchedAt: args.firstDispatchedAt,
    configureKey: args.configureKey,
  };
  const request = await projectRenewalConfigurationV2(configuration);
  if (request.status !== "projected_configure_request")
    throw Error(`RENEWAL_CONFIGURATION_${request.reason}`);
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  const record = {
    schemaVersion: 2,
    stage: "configure",
    profile: "node-endive-configure-v1",
    authorization: args.authorization,
    logicalOperationId: args.logicalOperationId,
    account: parent.account,
    apiVersion,
    requestBinding: request.requestIdentity.binding,
    dispatch: {
      scope,
      apiVersion,
      method,
      path,
      payload,
      key,
      firstDispatchedAt,
    },
    parentAttachment: {
      operationId: args.attachment.operationId,
      attemptId: args.attachment.attemptId,
      sourcePayloadId: args.attachment.sourcePayloadId,
      receiptBinding: receipt.binding,
    },
    configureRecord: {
      configuration,
      request,
      attachReceipt: receipt,
      originalBundle: parent.originalBundle,
    },
    timingPolicy: { ...parent.timingPolicy, firstDispatchedAt },
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
