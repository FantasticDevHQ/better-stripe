import type Stripe from "stripe";
import { readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";

function stockCall(token: object) {
  const lineage = readInitialLineage(token);
  const owner = ownerForInitialLineage(token);
  return Object.freeze({
    owner,
    call(args: Parameters<Stripe["rawRequest"]>) {
      return Reflect.apply(lineage.method, lineage.client, args) as ReturnType<
        Stripe["rawRequest"]
      >;
    },
  });
}

/** Transport kernels keep the original SDK promise and guard their continuation. */
export function captureInitialStockRawDelegate(
  token: object,
): Readonly<{ rawRequest: Stripe["rawRequest"] }> {
  if (arguments.length !== 1) throw Error("INITIAL_OPERATION_UNBOUND");
  const binding = stockCall(token);
  return Object.freeze({
    rawRequest(...args: Parameters<Stripe["rawRequest"]>) {
      binding.owner.check();
      return binding.call(args);
    },
  });
}

/** Fixed selected client and original receiver; no replacement-client parameter. */
export function stockDelegateForInitialLineage(token: object): Readonly<{
  rawRequest: Stripe["rawRequest"];
}> {
  const { owner, call } = stockCall(token);
  const owned = ownedAwaitForInitialLineage(token);
  return Object.freeze({
    rawRequest(
      ...args: Parameters<Stripe["rawRequest"]>
    ): ReturnType<Stripe["rawRequest"]> {
      owner.check();
      return owned(() => call(args)) as ReturnType<Stripe["rawRequest"]>;
    },
  });
}
