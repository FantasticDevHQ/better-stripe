import type Stripe from "stripe";
import { readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";

/** Fixed selected client and original receiver; no replacement-client parameter. */
export function stockDelegateForInitialLineage(token: object): Readonly<{
  rawRequest: Stripe["rawRequest"];
}> {
  const lineage = readInitialLineage(token);
  const owner = ownerForInitialLineage(token);
  const owned = ownedAwaitForInitialLineage(token);
  return Object.freeze({
    rawRequest(
      ...args: Parameters<Stripe["rawRequest"]>
    ): ReturnType<Stripe["rawRequest"]> {
      owner.check();
      return owned(() =>
        Reflect.apply(lineage.method, lineage.client, args),
      ) as ReturnType<Stripe["rawRequest"]>;
    },
  });
}
