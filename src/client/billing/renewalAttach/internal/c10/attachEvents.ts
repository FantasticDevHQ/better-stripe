import type { CapturedNode } from "./eventCodec.js";
import type { PreparedRenewalScheduleAttachmentV2 } from "../../../renewalV2/index.js";
// One distinct attach-stage channel, sequence1..3. No combined producer lineage.
import { need, stop, field, equalNodes, freeze, sevenWire } from "./ownData.js";
import {
  captureAttachSource,
  captureAttachDispatch,
  captureAttachResponse,
  captureAttachReceipt,
} from "./eventCapture.js";
import { materialize } from "./eventCodec.js";
import { createStageChannel } from "./appendAck.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "./publicApi.js";
export function createAttachEventCompiler(raw: unknown, options: unknown) {
  const channel = createStageChannel(options);
  let source: ReturnType<typeof captureAttachSource>;
  try {
    channel.gate();
    source = captureAttachSource(raw);
    channel.gate();
  } catch {
    channel.close();
    stop();
  }
  const append = channel.append;
  let position = 0,
    busy = false,
    closed = false,
    request: PreparedRenewalScheduleAttachmentV2 | undefined,
    requestNode: CapturedNode | undefined,
    response: Readonly<{ body: unknown }> | undefined;
  async function locked(
    expected: number,
    capture: (value: unknown) => CapturedNode,
    value: unknown,
    action: (node: CapturedNode) => void | Promise<void>,
  ) {
    try {
      channel.gate();
      if (closed || busy || position !== expected) {
        closed = true;
        channel.close();
        stop();
      }
      busy = true;
      const node = capture(value);
      channel.gate();
      return await channel.run(async () => {
        channel.gate();
        await action(node);
        channel.gate();
        need(!closed);
        await append(node);
        channel.gate();
        need(!closed);
        position++;
        return Object.freeze({
          kind: "C10_EVENT_DATA_APPENDED",
          stageChannel: "attach",
          actualFulfillmentEstablished: false,
          authenticationEstablished: false,
        });
      });
    } catch {
      closed = true;
      channel.close();
      stop();
    } finally {
      busy = false;
    }
  }

  const dispatch = (value: unknown) =>
    locked(0, captureAttachDispatch, value, async (node) => {
      channel.gate();
      const prepared = await prepareRenewalPriceReplacementV2(
        source.preparation,
      );
      channel.gate();
      need(!closed);
      channel.gate();
      const r = await prepareRenewalScheduleAttachmentV2({
        prepared,
        apiVersion: source.apiVersion,
        attachKey: source.attachKey,
        firstDispatchedAt: source.firstDispatchedAt,
      });
      channel.gate();
      need(!closed);
      const proof = captureAttachDispatch({
        event: "dispatch",
        stage: "attach",
        request: r,
      });
      need(equalNodes(node, proof));
      request = freeze(r);
      requestNode = field(proof, "request");
    });
  const responseEvent = (value: unknown) =>
    locked(1, captureAttachResponse, value, async (node) => {
      need(
        request &&
          requestNode &&
          equalNodes(field(node, "request"), requestNode),
      );
      // Safe admitted response retained BEFORE any C3 identity/receipt requirement.
      response = freeze({ body: materialize(field(node, "body")) });
    });
  const receipt = (value: unknown) =>
    locked(2, captureAttachReceipt, value, async (node) => {
      need(
        response &&
          request &&
          requestNode &&
          equalNodes(field(node, "request"), requestNode),
      );
      channel.gate();
      const r = await constructRenewalScheduleAttachmentReceiptV2({
        attachRequest: source,
        actualDispatch: sevenWire(request),
        providerSnapshot: response.body as Record<string, unknown>,
      });
      channel.gate();
      need(!closed);
      const proof = captureAttachReceipt({
        event: "receipt",
        stage: "attach",
        request,
        receipt: r,
      });
      need(equalNodes(node, proof));
    });
  return Object.freeze({
    stageChannel: "attach",
    combinedProducerLineageEstablished: false,
    dispatch,
    response: responseEvent,
    receipt,
  });
}
