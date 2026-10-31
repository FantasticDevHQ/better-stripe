import { readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";

const journals = new WeakMap<object, ReturnType<typeof construct>>();
function construct(token: object) {
  const lineage = readInitialLineage(token);
  const owner = ownerForInitialLineage(token);

  let pending = 0;
  async function track<T>(work: () => Promise<T>): Promise<T> {
    owner.check();
    pending++;
    try {
      // Track the actual journal promise, independently of a channel's timeout.
      return await work();
    } finally {
      pending--;
    }
  }
  return Object.freeze({
    captureSend() {
      if (arguments.length !== 0) throw Error("INITIAL_OPERATION_UNBOUND");
      owner.check();
      const send = lineage.journal.createC10Send(lineage.reservation);
      return (
        record: Parameters<typeof send>[0],
        ack: Parameters<typeof send>[1],
      ) => track(() => send(record, ack));
    },
    retain(
      input: Parameters<
        typeof lineage.journal.retainProviderAcknowledgement
      >[0],
    ) {
      return track(() => lineage.journal.retainProviderAcknowledgement(input));
    },
    idle() {
      owner.check();
      return pending === 0;
    },
  });
}
/** Original journal work only; channel closure cannot hide a pending mutation. */
export function journalWorkForInitialLineage(token: object) {
  if (arguments.length !== 1) throw Error("INITIAL_OPERATION_UNBOUND");
  const owner = ownerForInitialLineage(token);
  owner.check();
  let work = journals.get(token);
  if (!work) {
    work = construct(token);
    journals.set(token, work);
  }
  return work;
}
