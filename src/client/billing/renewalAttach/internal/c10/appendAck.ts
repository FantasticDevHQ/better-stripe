/** Stage and append share one irreversible latch and the same original owner. */
import { SOURCE_OWNER } from "./ownerBinding.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import {
  options as checkedOptions,
  closed,
  need,
  stop,
  freeze,
} from "./ownData.js";
import {
  objectNode,
  scalarNode,
  eventDigest,
  materialize,
  type CapturedNode,
} from "./eventCodec.js";
type Time = { wallMs: number; ns: bigint };
type Reject = (reason: Error) => void;
export function createStageChannel(raw: unknown) {
  return stageChannel(raw, SOURCE_OWNER);
}
/** Opaque original lineage only; no caller-supplied Owner or clock. */
export function createInitialStageChannel(token: object, raw: unknown) {
  return stageChannel(raw, ownerForInitialLineage(token));
}
function stageChannel(
  raw: unknown,
  owner: Pick<typeof SOURCE_OWNER, "basis" | "check" | "subscribe">,
) {
  let closedChannel = false,
    unsubscribe = () => {},
    rejectStage: Reject | null = null,
    rejectAppend: Reject | null = null,
    last: Time | null = null;
  const close = () => {
    if (closedChannel) return;
    closedChannel = true;
    unsubscribe();
    rejectStage?.(Error("C10_SOURCE_STOP"));
    rejectAppend?.(Error("C10_SOURCE_STOP"));
  };
  const basis = owner.basis;
  const gate = (): Time => {
    try {
      need(!closedChannel);
      const t = owner.check();
      need(
        basis &&
          Number.isSafeInteger(basis.startWallMs) &&
          Number.isSafeInteger(basis.workEndWallMs) &&
          Number.isSafeInteger(basis.endWallMs) &&
          typeof basis.startNs === "bigint" &&
          typeof basis.workEndNs === "bigint" &&
          typeof basis.endNs === "bigint" &&
          basis.startWallMs < basis.workEndWallMs &&
          basis.workEndWallMs <= basis.endWallMs &&
          basis.startNs < basis.workEndNs &&
          basis.workEndNs <= basis.endNs,
      );
      need(
        t &&
          Number.isSafeInteger(t.wallMs) &&
          typeof t.ns === "bigint" &&
          t.wallMs >= basis.startWallMs &&
          t.ns >= basis.startNs &&
          t.wallMs < basis.workEndWallMs &&
          t.ns < basis.workEndNs &&
          t.wallMs < basis.endWallMs &&
          t.ns < basis.endNs &&
          (!last || (t.wallMs >= last.wallMs && t.ns >= last.ns)),
      );
      last = { wallMs: t.wallMs, ns: t.ns };
      return last;
    } catch {
      close();
      stop();
    }
  };
  gate();
  const detach = owner.subscribe(close);
  need(typeof detach === "function");
  unsubscribe = detach;
  if (closedChannel) unsubscribe();
  gate();
  let options: ReturnType<typeof checkedOptions>;
  try {
    options = checkedOptions(raw);
    gate();
  } catch {
    close();
    stop();
  }
  let sequence = 0,
    pending = false;
  async function run<T>(action: () => T | PromiseLike<T>): Promise<T> {
    gate();
    let reject!: Reject;
    const fatal = new Promise<never>((_, r) => {
      reject = r;
    });
    rejectStage = reject;
    const operation = Promise.resolve().then(() => {
      gate();
      return action();
    });
    try {
      const value = await Promise.race([operation, fatal]);
      gate();
      return value;
    } catch {
      close();
      return stop();
    } finally {
      if (rejectStage === reject) rejectStage = null;
    }
  }
  async function append(input: CapturedNode): Promise<void> {
    if (closedChannel || pending) stop();
    pending = true;
    let entry: Time;
    try {
      entry = gate();
    } catch {
      pending = false;
      stop();
    }
    let timer: ReturnType<typeof setTimeout> | undefined,
      received = false,
      failed = false,
      sent = false,
      accept!: () => void,
      rejectFatal!: Reject;
    const acknowledged = new Promise<void>((resolve) => {
      accept = resolve;
    });
    const fatal = new Promise<never>((_, reject) => {
      rejectFatal = reject;
    });
    const fail = () => {
      failed = true;
      close();
      rejectFatal(Error("C10_SOURCE_STOP"));
    };
    rejectAppend = fail;
    let localGate!: () => Time, arm!: () => void;
    const operation = Promise.resolve().then(async () => {
      const next = sequence + 1;
      need(Number.isSafeInteger(next) && next > 0);
      const wallEnd = Math.min(
          entry.wallMs + options.timeoutMs,
          basis.workEndWallMs,
          basis.endWallMs,
        ),
        localNs = entry.ns + BigInt(options.timeoutMs) * 1000000n;
      const nsEnd =
        localNs < basis.workEndNs
          ? localNs < basis.endNs
            ? localNs
            : basis.endNs
          : basis.workEndNs < basis.endNs
            ? basis.workEndNs
            : basis.endNs;
      localGate = () => {
        const t = gate();
        need(!failed && pending && t.wallMs < wallEnd && t.ns < nsEnd);
        return t;
      };
      arm = () => {
        const t = localGate(),
          left = Math.min(
            wallEnd - t.wallMs,
            Number((nsEnd - t.ns + 999999n) / 1000000n),
          );
        need(left > 0);
        timer = setTimeout(() => {
          try {
            arm();
          } catch {
            fail();
          }
        }, left);
      };
      arm();
      localGate();
      const envelope = objectNode([
          ["sequence", scalarNode(next)],
          ["data", input],
        ]),
        binding = await eventDigest(envelope);
      localGate();
      const data = freeze(materialize(input)),
        record = Object.freeze({ sequence: next, binding, data });
      localGate();
      const ack = (value: unknown) => {
        try {
          if (received || failed || !pending || closedChannel) return fail();
          localGate();
          const v = closed(value, ["sequence", "binding"]);
          need(v.sequence === next && v.binding === binding);
          localGate();
          received = true;
          accept();
        } catch {
          fail();
        }
      };
      const sendNow = () => {
        localGate();
        return Promise.resolve(options.send(record, ack)).then(() => {
          localGate();
          sent = true;
        });
      };
      await Promise.all([Promise.resolve().then(sendNow), acknowledged]);
      localGate();
      need(sent && received && sequence === next - 1);
      sequence = next;
    });
    const outcome = Promise.race([operation, fatal]);
    try {
      await outcome;
      localGate();
    } catch {
      fail();
      stop();
    } finally {
      clearTimeout(timer);
      pending = false;
      if (rejectAppend === fail) rejectAppend = null;
    }
  }
  return Object.freeze({ gate, close, run, append });
}
export function createAppendAckAdapter(raw: unknown) {
  return createStageChannel(raw).append;
}
