import type { EventRecord } from "./ownData.js";
import "./test-fixtures/semanticSetup.js";
import { it as test } from "vitest";
import assert from "node:assert/strict";
import {
  createAttachEventCompiler,
  createConfigureEventCompiler,
} from "./test-fixtures/compilerIndex.mjs";
import * as sdk from "./publicApi.js";
import * as material from "./test-fixtures/frozen/f12.mjs";
import {
  copy,
  wire,
  configureCase,
  expectedPrepared,
  binding,
} from "./test-fixtures/publishedRawkeyHelper.mjs";
// NEW raw facts are declared by configureCase before constructing any child. No provider observed.
test("0881 six C10 events and both classifier stages rebuild the same complete raw children", async () => {
  const x = configureCase(),
    sourceConfigure = copy(x.configuration),
    sourceAttach = copy(sourceConfigure.attachReceipt.attachRequest);
  const prepared = await sdk.prepareRenewalPriceReplacementV2(
    copy(sourceAttach.preparation),
  );
  assert.deepEqual(prepared, expectedPrepared(sourceAttach.preparation));
  const request = await sdk.prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: sourceAttach.apiVersion,
    attachKey: sourceAttach.attachKey,
    firstDispatchedAt: sourceAttach.firstDispatchedAt,
  });
  const attach = await sdk.constructRenewalScheduleAttachmentReceiptV2(
    copy(sourceConfigure.attachReceipt),
  );
  const configure = await sdk.projectRenewalConfigurationV2(
    copy(sourceConfigure),
  );
  assert.equal(configure.status, "projected_configure_request");
  // Identity-valid unchanged baseline response deliberately makes no configuration-application claim.
  const responseBody = copy(sourceConfigure.schedule),
    transport = { status: 200, requestId: "req_SYNTHETIC_ADOPTION" };
  const stored = await sdk.constructRenewalConfigurationReceiptV2({
    configuration: copy(sourceConfigure),
    actualDispatch: wire(configure),
    providerSnapshot: responseBody,
    transport,
  });
  const a = await material.classifyRetainedAttachmentV2({
      attachRequest: copy(sourceAttach),
      intent: "initial",
    }),
    c = await material.classifyFreshConfigurationV2(copy(x));
  assert.equal(a.status, "classified");
  assert.equal(c.status, "classified");
  assert.deepEqual(a.material.originalPrepared, prepared);
  assert.deepEqual(c.material.originalPrepared, prepared);
  assert.deepEqual(a.material.completeRequest, request);
  assert.deepEqual(c.material.completeRequest, configure);
  assert.deepEqual(c.material.stageEvidence.acknowledgedAttachReceipt, attach);
  for (const stage of ["attach", "configure"] as const) {
    const records: EventRecord[] = [],
      opts = {
        timeoutMs: 5000,
        send: async (r: EventRecord, ack: (value: unknown) => void) => {
          records.push(r);
          ack({ sequence: r.sequence, binding: r.binding });
        },
      };
    const compiler =
      stage === "attach"
        ? createAttachEventCompiler(sourceAttach, opts)
        : createConfigureEventCompiler(sourceConfigure, opts);
    const events =
      stage === "attach"
        ? [
            { event: "dispatch", stage, request },
            {
              event: "response",
              stage,
              request,
              body: copy(sourceConfigure.attachReceipt.providerSnapshot),
              status: 200,
            },
            { event: "receipt", stage, request, receipt: attach },
          ]
        : [
            { event: "dispatch", stage, request: configure },
            {
              event: "response",
              stage,
              request: configure,
              body: responseBody,
              transport,
            },
            { event: "receipt", stage, request: configure, receipt: stored },
          ];
    const expected = copy(events);
    for (const event of events)
      await compiler[event.event as "dispatch" | "response" | "receipt"](event);
    assert.equal(records.length, 3);
    for (const [i, r] of records.entries()) {
      assert.equal(r.sequence, i + 1);
      assert.deepEqual(r.data, expected[i]);
      assert.equal(
        r.binding,
        binding("unbound-qualification-event", {
          sequence: i + 1,
          data: expected[i],
        }),
      );
    }
  }
});
