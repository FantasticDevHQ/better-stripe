import assert from "node:assert/strict";
import { it } from "vitest";
import { declaredInputs } from "../test-fixtures/attachEntries.js";
import { metrics, data } from "../test-fixtures/attachScenarioBarriers.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
import { admitInitialOutput } from "../recovery/material.js";

it("initial ACK whole DATA wrapper enforces exact receipt slots, bounds and freezing", async () => {
  const raw = declaredInputs("INITIAL-ACK"),
    prepared = await prepareRenewalPriceReplacementV2(
      raw.original.attachRequest.preparation,
    );
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: raw.original.attachRequest.apiVersion,
    attachKey: raw.original.attachRequest.attachKey,
    firstDispatchedAt: raw.original.attachRequest.firstDispatchedAt,
  });
  const receipt = await constructRenewalScheduleAttachmentReceiptV2({
    attachRequest: raw.original.attachRequest,
    actualDispatch: {
      scope: request.scope,
      apiVersion: request.apiVersion,
      method: request.method,
      path: request.path,
      payload: request.payload,
      key: request.key,
      firstDispatchedAt: request.firstDispatchedAt,
    },
    providerSnapshot: raw.post,
  });
  const admitted = admitInitialOutput(receipt, prepared, request);
  assert(Object.isFrozen(admitted));
  assert(Object.isFrozen(data(admitted).receipt));
  const fit = metrics(admitted);
  assert(
    fit.chars <= 500000 &&
      fit.bytes <= 500000 &&
      fit.nodes <= 10000 &&
      fit.depth <= 40,
  );
  // DATA-helper boundary only: a caller's extended receipt-shaped input is not C3 custody.
  const overflow = { ...receipt, opaque: "x".repeat(500001) };
  assert(
    metrics({
      status: "attach_acknowledged",
      operationalAuthority: false,
      receipt: overflow,
    }).chars > 500000,
  );
  assert.throws(() => admitInitialOutput(overflow, prepared, request));
  const wrong = {
    ...receipt,
    logicalBinding: "renewal:v2:sha256:" + "0".repeat(64),
  };
  assert.throws(() => admitInitialOutput(wrong, prepared, request));
});
