import { readConfigureRecoveryAuthority } from "../producer/configureAttemptAuthority.js";
import type { CapturedNode } from "./eventCodec.js";
import type {
  ProjectedRenewalConfigurationV2,
  ConstructRenewalConfigurationReceiptV2Options,
} from "../../../renewalV2/index.js";
// One distinct configure-stage channel, sequence1..3. No combined producer lineage.
import { need, stop, field, equalNodes, freeze, sevenWire } from "./ownData.js";
import {
  captureConfigureSource,
  captureConfigureDispatch,
  captureConfigureResponse,
  captureConfigureReceipt,
} from "./eventCapture.js";
import { materialize } from "./eventCodec.js";
import {
  createStageChannel,
  createGuardedInitialStageChannel,
} from "./appendAck.js";
import { readConfigureLineage } from "../producer/configureLineage.js";
import { journalWorkForConfigureLineage } from "../producer/configureJournalWork.js";
import {
  projectRenewalConfigurationV2,
  constructRenewalConfigurationReceiptV2,
} from "./publicApi.js";
export function createConfigureEventCompiler(raw: unknown, options: unknown) {
  return configureEventCompiler(raw, createStageChannel(options));
}
const admittedChannels = new WeakSet<object>();
/** One exact admitted child, without replacement source, sender or Owner inputs. */
export function createAdmittedConfigureEventCompiler(token: object) {
  if (typeof token !== "object" || token === null)
    throw Error("CONFIGURE_CHANNEL_UNBOUND");
  if (admittedChannels.has(token)) throw Error("CONFIGURE_CHANNEL_CONSUMED");
  admittedChannels.add(token);
  if (arguments.length !== 1) throw Error("CONFIGURE_CHANNEL_UNBOUND");
  const lineage = readConfigureLineage(token);
  const send = journalWorkForConfigureLineage(token).captureSend();
  const guard = () => {
    readConfigureLineage(token);
  };
  const channel = createGuardedInitialStageChannel(
    lineage.parentToken,
    {
      timeoutMs: 5000,
      send(
        record: Parameters<typeof send>[0],
        ack: Parameters<typeof send>[1],
      ) {
        guard();
        return send(record, (value) => {
          guard();
          ack(value);
          guard();
        });
      },
    },
    guard,
  );
  return configureEventCompiler(lineage.configuration, channel);
}
const recoveryChannels = new WeakSet<object>();
/** Distinct original-journal sender after synchronous actual recovery reservation. */
export function createRecoveryConfigureEventCompiler(recovery: object) {
  need(
    typeof recovery === "object" &&
      recovery !== null &&
      !recoveryChannels.has(recovery),
  );
  recoveryChannels.add(recovery);
  need(arguments.length === 1);
  const state = readConfigureRecoveryAuthority(recovery);
  const lineage = readConfigureLineage(state.token);
  const guard = () => {
    readConfigureRecoveryAuthority(recovery);
  };
  const send = journalWorkForConfigureLineage(state.token).captureSend();
  const channel = createGuardedInitialStageChannel(
    lineage.parentToken,
    {
      timeoutMs: 5000,
      send(
        record: Parameters<typeof send>[0],
        ack: Parameters<typeof send>[1],
      ) {
        guard();
        return send(record, (value) => {
          guard();
          ack(value);
          guard();
        });
      },
    },
    guard,
  );
  return configureEventCompiler(lineage.configuration, channel);
}
function configureEventCompiler(
  raw: unknown,
  channel: ReturnType<typeof createStageChannel>,
) {
  let source: ReturnType<typeof captureConfigureSource>;
  try {
    channel.gate();
    source = captureConfigureSource(raw);
    channel.gate();
  } catch {
    channel.close();
    stop();
  }
  const append = channel.append;
  let position = 0,
    busy = false,
    closed = false,
    request: ProjectedRenewalConfigurationV2 | undefined,
    requestNode: CapturedNode | undefined,
    response:
      | Readonly<{
          body: unknown;
          transport: ConstructRenewalConfigurationReceiptV2Options["transport"];
        }>
      | undefined;
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
          stageChannel: "configure",
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
    locked(0, captureConfigureDispatch, value, async (node) => {
      channel.gate();
      const r = await projectRenewalConfigurationV2(source);
      channel.gate();
      need(r.status === "projected_configure_request" && !closed);
      const proof = captureConfigureDispatch({
        event: "dispatch",
        stage: "configure",
        request: r,
      });
      need(equalNodes(node, proof));
      request = freeze(r);
      requestNode = field(proof, "request");
    });
  const responseEvent = (value: unknown) =>
    locked(1, captureConfigureResponse, value, async (node) => {
      need(
        request &&
          requestNode &&
          equalNodes(field(node, "request"), requestNode),
      );
      response = freeze({
        body: materialize(field(node, "body")),
        transport: materialize(
          field(node, "transport"),
        ) as ConstructRenewalConfigurationReceiptV2Options["transport"],
      });
    });
  const receipt = (value: unknown) =>
    locked(2, captureConfigureReceipt, value, async (node) => {
      need(
        response &&
          request &&
          requestNode &&
          equalNodes(field(node, "request"), requestNode),
      );
      channel.gate();
      const r = await constructRenewalConfigurationReceiptV2({
        configuration: source,
        actualDispatch: sevenWire(request),
        providerSnapshot: response.body as Record<string, unknown>,
        transport: response.transport,
      });
      channel.gate();
      need(!closed);
      const proof = captureConfigureReceipt({
        event: "receipt",
        stage: "configure",
        request,
        receipt: r,
      });
      need(equalNodes(node, proof));
    });
  return Object.freeze({
    stageChannel: "configure",
    combinedProducerLineageEstablished: false,
    dispatch,
    response: responseEvent,
    receipt,
  });
}
