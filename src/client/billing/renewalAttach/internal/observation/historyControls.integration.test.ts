import { expect } from "vitest";
import { configureAdmissionCase } from "../test-fixtures/producerConfigureAdmission.js";
import {
  historySnapshot,
  historyPrefix,
  type HistorySnapshot,
} from "../test-fixtures/historySnapshot.js";
import { captureRetainedObservationHistory } from "./history.js";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { renewalSnapshot } from "../../../renewalReplacementSnapshot.js";

// Mutable controlled fixture DATA only, never the detached production reader.
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("FIXTURE_OBJECT");
  return value as Record<string, unknown>;
}

function rewriteRecord(
  s: HistorySnapshot,
  change: (r: Record<string, unknown>) => void,
) {
  const record = object(JSON.parse(s.configure.operation.recordJSON));
  change(record);
  const json = JSON.stringify(renewalSnapshot(record));
  s.configure.operation.recordJSON = json;
  s.configure.attempt.reservation.recordJSON = json;
}
async function rewriteEvent(
  s: HistorySnapshot,
  change: (r: Record<string, unknown>) => void,
) {
  const event = s.configure.events[1]!;
  const data = object(JSON.parse(event!.dataJSON));
  change(data);
  const canonical = await canonicalJournalEvent(2, JSON.stringify(data));
  Object.assign(event!, {
    binding: canonical.binding,
    dataJSON: canonical.json,
  });
  s.configure.attempt.events[1].binding = canonical.binding;
}

configureAdmissionCase(
  "rejects inconsistent full history, response, C9 and immutable parent relations",
  historySnapshot,
  async (_h, full) => {
    const controls: [string, (s: HistorySnapshot) => void | Promise<void>][] = [
      [
        "foreign parent",
        (s) =>
          rewriteRecord(s, (r) => {
            object(r.parentAttachment).operationId = "foreign";
          }),
      ],
      [
        "raw original material",
        (s) =>
          rewriteRecord(s, (r) => {
            object(
              object(object(r.configureRecord).originalBundle).wireTargetPrice,
            ).metadata = { changed: true };
          }),
      ],
      [
        "account",
        (s) =>
          rewriteRecord(s, (r) => {
            object(r.account).livemode = true;
          }),
      ],
      [
        "deadline",
        (s) =>
          rewriteRecord(s, (r) => {
            const p = object(r.timingPolicy);
            p.endWallMs = Number(p.endWallMs) + 1;
          }),
      ],
      [
        "basis",
        (s) => {
          object(object(s.configure.operation).initialBasis).basisJSON = "{}";
        },
      ],
      [
        "missing bound basis",
        (s) => {
          Object.assign(s.configure.operation, { initialBasis: null });
        },
      ],
      [
        "descriptor mismatch",
        (s) => {
          s.configure.attempt.events[0].eventId = "other-event";
        },
      ],
      [
        "binding mismatch",
        (s) => {
          s.configure.events[0]!.binding = "wrong";
          s.configure.attempt.events[0].binding = "wrong";
        },
      ],
      [
        "response request",
        async (s) =>
          rewriteEvent(s, (r) => {
            object(r.request).key = "different-key";
          }),
      ],
      [
        "response body",
        async (s) =>
          rewriteEvent(s, (r) => {
            object(r.body).id = "sub_sched_foreign";
          }),
      ],
      [
        "contradictory C9",
        (s) => {
          const ack = s.configure.acknowledgement!;
          const r = JSON.parse(ack.receiptJSON);
          r.providerSnapshot.metadata = { changed: true };
          ack.receiptJSON = JSON.stringify(renewalSnapshot(r));
        },
      ],
      [
        "missing head3 retention",
        (s) => {
          s.configure.acknowledgement = null;
        },
      ],
      [
        "retention source alias",
        (s) => {
          s.configure.acknowledgement!.retention.receiptPayloadId =
            s.configure.attempt.reservation.payloadId;
        },
      ],
      [
        "retention event alias",
        (s) => {
          s.configure.acknowledgement!.retention.receiptPayloadId =
            s.configure.attempt.events[2].payloadId;
        },
      ],
      [
        "retention event identity alias",
        (s) => {
          s.configure.acknowledgement!.retention.receiptPayloadId =
            s.configure.attempt.events[1].eventId;
        },
      ],
      [
        "parent receipt alias",
        (s) => {
          s.parent.acknowledgement!.retention.receiptPayloadId =
            s.parent.attempt.reservation.payloadId;
        },
      ],
      [
        "cross stage payload alias",
        (s) => {
          s.configure.acknowledgement!.retention.receiptPayloadId =
            s.parent.acknowledgement!.retention.receiptPayloadId;
        },
      ],
      [
        "parent event missing",
        (s) => {
          s.parent.events.pop();
          s.parent.attempt.events.pop();
        },
      ],
      [
        "extra stage key",
        (s) => {
          Object.assign(s.configure, { callback: null });
        },
      ],
    ];
    for (const [name, change] of controls) {
      const s = structuredClone(full);
      await change(s);
      let refused = false;
      try {
        await captureRetainedObservationHistory(s);
      } catch {
        refused = true;
      }
      expect(refused, name).toBe(true);
    }
    const absent = historyPrefix(full, 2);
    await rewriteEvent(absent, (r) => {
      object(r.body).id = "sub_sched_foreign";
    });
    await expect(
      captureRetainedObservationHistory(absent),
      "foreign response without retained C9",
    ).rejects.toThrow();
  },
);

configureAdmissionCase(
  "rejects proxy traps, getters, hidden keys, sparse arrays and oversized graphs before awaits",
  historySnapshot,
  async (_h, full) => {
    let touched = 0;
    const proxy = new Proxy(full, {
      ownKeys() {
        touched++;
        throw Error("TRAP");
      },
    });
    await expect(captureRetainedObservationHistory(proxy)).rejects.toThrow();
    expect(touched).toBe(0);
    const getter = { ...full };
    Object.defineProperty(getter, "parent", {
      enumerable: true,
      get() {
        touched++;
        return full.parent;
      },
    });
    await expect(captureRetainedObservationHistory(getter)).rejects.toThrow();
    expect(touched).toBe(0);
    const hidden = structuredClone(full);
    Object.defineProperty(hidden.configure, "secret", { value: true });
    await expect(captureRetainedObservationHistory(hidden)).rejects.toThrow();
    const sparse = structuredClone(full);
    delete sparse.configure.events[0];
    await expect(captureRetainedObservationHistory(sparse)).rejects.toThrow();
    const huge = structuredClone(full);
    huge.configure.operation.recordJSON = "x".repeat(500001);
    await expect(captureRetainedObservationHistory(huge)).rejects.toThrow();
  },
);
