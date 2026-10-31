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
import { createStageChannel, createInitialStageChannel } from "./appendAck.js";
import { readInitialLineage } from "../producer/lineageAuthority.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import { ownedAwaitForInitialLineage } from "../producer/ownedAwaitFactory.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
} from "./publicApi.js";
export function createAttachEventCompiler(raw: unknown, options: unknown) {
  return attachEventCompiler(raw, createStageChannel(options));
}
const initialChannels = new WeakSet<object>();
/** Exact original call, source and journal; no replacement sink or Owner input. */
export function createInitialAttachEventCompiler(token: object) {
  const owner = ownerForInitialLineage(token);
  owner.check();
  if (initialChannels.has(token)) throw Error("INITIAL_CHANNEL_CONSUMED");
  initialChannels.add(token);
  if (arguments.length !== 1) throw Error("INITIAL_CHANNEL_UNBOUND");
  const { reservation, journal } = readInitialLineage(token);
  const source = JSON.parse(reservation.recordJSON);
  const send = journal.createC10Send(reservation);
  const owned = ownedAwaitForInitialLineage(token);
  owner.check();
  const channel = createInitialStageChannel(token, {
    timeoutMs: 5000,
    send: (
      record: Parameters<typeof send>[0],
      ack: Parameters<typeof send>[1],
    ) =>
      owned(() =>
        send(record, (value) => {
          owner.check();
          ack(value);
          owner.check();
        }),
      ),
  });
  return attachEventCompiler(source.attachRequest, channel);
}
function attachEventCompiler(
  raw: unknown,
  channel: ReturnType<typeof createStageChannel>,
) {
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
