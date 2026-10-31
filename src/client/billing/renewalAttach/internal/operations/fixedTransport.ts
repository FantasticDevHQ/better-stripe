import { build } from "./transportKernel.js";
export type { PostDisposition, Quarantine } from "./transportKernel.js";
import { closed, need } from "./types.js";
import { OWNER } from "../originalOwner.js";
import {
  loadInitialOwnedTransportSource,
  loadRecoveryOwnedTransportSource,
  loadOwnedTransportSource,
} from "./sourceOperations.js";
import { ownerForInitialLineage } from "../producer/ownerFactory.js";
import { ownedAwaitForInitialLineage } from "../producer/ownedAwaitFactory.js";
import { operationForInitialLineage } from "../producer/operationFactory.js";
export function createOwnedTransportWithAttemptCapability() {
  need(arguments.length === 0);
  OWNER.check();
  const source = loadOwnedTransportSource();
  OWNER.check();
  return build(source);
}

function createAssociatedPair(load: () => unknown) {
  OWNER.check();
  const raw = load();
  OWNER.check();
  const frame = closed(raw, [
    "owner",
    "operation",
    "request",
    "readPlan",
    "delegate",
  ]);
  need(frame.owner === OWNER);
  const { operation, readPlan, delegate } = frame;
  return build(
    { owner: OWNER, request: frame.request, readPlan, delegate },
    Object.freeze({ operation, readPlan, delegate }),
  );
}
export function createInitialOwnedTransportWithAttemptCapability() {
  need(arguments.length === 0);
  return createAssociatedPair(loadInitialOwnedTransportSource);
}
export function createRecoveryOwnedTransportWithAttemptCapability() {
  need(arguments.length === 0);
  return createAssociatedPair(loadRecoveryOwnedTransportSource);
}

const initialTransports = new WeakMap<
  object,
  Promise<ReturnType<typeof build>>
>();
/** Canonical private transport, constructed only from the original lineage. */
export function createInitialTransportForLineage(token: object) {
  if (arguments.length !== 1) throw Error("INITIAL_OPERATION_UNBOUND");
  const owner = ownerForInitialLineage(token);
  owner.check();
  const owned = ownedAwaitForInitialLineage(token);
  let pending = initialTransports.get(token);
  if (!pending) {
    pending = owned(async () => {
      try {
        const frame = await operationForInitialLineage(token);
        owner.check();
        return build(
          {
            owner,
            request: frame.request,
            readPlan: frame.operation.readPlan,
            delegate: frame.operation.delegate,
          },
          {
            operation: frame.operation,
            readPlan: frame.operation.readPlan,
            delegate: frame.operation.delegate,
          },
          token,
        );
      } catch (error) {
        owner.retire();
        throw error;
      }
    });
    initialTransports.set(token, pending);
  }
  const captured = pending;
  return owned(() => captured);
}
