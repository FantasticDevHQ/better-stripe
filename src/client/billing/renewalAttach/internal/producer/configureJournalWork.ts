import { readConfigureLineage } from "./configureLineage.js";
import { requireConfigure } from "./configureJournalData.js";

const journals = new WeakMap<object, ReturnType<typeof construct>>();
function construct(token: object) {
  const original = readConfigureLineage(token);
  let pending = 0;
  function gate() {
    const current = readConfigureLineage(token);
    requireConfigure(
      current.journal === original.journal &&
        current.originalReservation === original.originalReservation &&
        current.owner === original.owner,
    );
  }
  return Object.freeze({
    captureSend() {
      requireConfigure(arguments.length === 0);
      gate();
      // Original class-owned object custody; captured reservation DATA cannot send.
      const send = original.journal.createC10Send(original.originalReservation);
      return async (
        record: Parameters<typeof send>[0],
        ack: Parameters<typeof send>[1],
      ) => {
        gate();
        pending++;
        try {
          await send(record, ack);
          gate();
        } finally {
          pending--;
        }
      };
    },
    async retain(receiptJSON: string) {
      requireConfigure(arguments.length === 1);
      gate();
      pending++;
      try {
        const reply = await original.journal.retainProviderAcknowledgement({
          attemptId: original.reservation.attemptId,
          expectedSequence: 2,
          receiptJSON,
        });
        gate();
        return reply;
      } finally {
        pending--;
      }
    },
    idle() {
      requireConfigure(arguments.length === 0);
      gate();
      return pending === 0;
    },
  });
}
/** Actual RPC settlement is tracked independently of channel closure or timeout. */
export function journalWorkForConfigureLineage(token: object) {
  requireConfigure(arguments.length === 1);
  readConfigureLineage(token);
  let work = journals.get(token);
  if (!work) {
    work = construct(token);
    journals.set(token, work);
  }
  return work;
}
