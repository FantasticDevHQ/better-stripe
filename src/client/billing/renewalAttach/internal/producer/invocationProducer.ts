import { mintInitialLineage, readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage, type InitialOwner } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { stockDelegateForInitialLineage } from "./stockDelegateFactory.js";
import type { createClassActionOperationJournal } from "../operationJournal.js";
import { createInitialAttachEventCompiler } from "../c10/attachEvents.js";
import { createInitialMaterialClassifiers } from "../material/classifiers.js";
import { createInitialTransportForLineage } from "../operations/fixedTransport.js";
import {
  acquisitionForInitialLineage,
  type RawAcquisitionResult,
} from "../acquisition/ownedAcquisition.js";
import { captureInitialAttachForLineage } from "../operations/initialAttach.js";

export type InitialInvocationCore = Readonly<{
  owner: InitialOwner;
  basisJSON: string;
  delegate: ReturnType<typeof stockDelegateForInitialLineage>;
  owned<T>(work: () => T | PromiseLike<T>): Promise<T>;
  attachEvents(): ReturnType<typeof createInitialAttachEventCompiler>;
  material: ReturnType<typeof createInitialMaterialClassifiers>;
  transport(): ReturnType<typeof createInitialTransportForLineage>;
  acquire(): Promise<RawAcquisitionResult>;
  initialAttach(): ReturnType<typeof captureInitialAttachForLineage>;
  operationalAuthority: false;
}>;

/** Node-only private construction. Does not admit an operational runtime profile. */
export async function captureInitialInvocationCore(
  call: unknown,
  journal: Awaited<ReturnType<typeof createClassActionOperationJournal>>,
): Promise<InitialInvocationCore> {
  const token = mintInitialLineage(call, journal, arguments.length);
  const lineage = readInitialLineage(token);
  const owner = ownerForInitialLineage(token);
  try {
    const owned = ownedAwaitForInitialLineage(token);
    const reservation = lineage.reservation;
    if (!("timingPolicyJSON" in reservation))
      throw Error("INITIAL_LINEAGE_UNBOUND");
    const bound = await owned(() =>
      journal.bindInitialBasis({
        attemptId: reservation.attemptId,
        policyJSON: reservation.timingPolicyJSON,
        basisJSON: lineage.basisJSON,
      }),
    );
    if (
      bound.status !== "bound" ||
      bound.operationId !== reservation.operationId ||
      bound.initialBasis.attemptId !== reservation.attemptId ||
      bound.initialBasis.sourcePayloadId !== reservation.payloadId ||
      bound.initialBasis.basisJSON !== lineage.basisJSON ||
      bound.initialBasis.policyJSON !== reservation.timingPolicyJSON ||
      bound.initialBasis.stage !== "attach" ||
      bound.initialBasis.version !== 1
    )
      throw Error("INITIAL_LINEAGE_UNBOUND");
    owner.check();
    let channelCaptured = false;
    return Object.freeze({
      owner,
      basisJSON: lineage.basisJSON,
      owned,
      delegate: stockDelegateForInitialLineage(token),
      attachEvents() {
        owner.check();
        if (channelCaptured) throw Error("INITIAL_CHANNEL_CONSUMED");
        channelCaptured = true;
        if (arguments.length !== 0) throw Error("INITIAL_CHANNEL_UNBOUND");
        return createInitialAttachEventCompiler(token);
      },
      material: createInitialMaterialClassifiers(token),
      async transport() {
        if (arguments.length !== 0) throw Error("INITIAL_OPERATION_UNBOUND");
        return owned(() => createInitialTransportForLineage(token));
      },
      async acquire() {
        if (arguments.length !== 0) throw Error("INITIAL_OPERATION_UNBOUND");
        const reader = await owned(() => acquisitionForInitialLineage(token));
        return owned(() => reader.acquire());
      },
      initialAttach() {
        if (arguments.length !== 0) throw Error("INITIAL_OPERATION_UNBOUND");
        return captureInitialAttachForLineage(token);
      },
      operationalAuthority: false,
    });
  } catch (error) {
    owner.retire();
    throw error;
  }
}
