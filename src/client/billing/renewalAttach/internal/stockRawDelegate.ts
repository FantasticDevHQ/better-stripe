import Stripe from "stripe";
import { types } from "node:util";
import { OWNER } from "./originalOwner.js";
import { loadFixedStockClient } from "./sourceBindings.js";

function stop(): never {
  throw new Error("STOCK_SOURCE_DELEGATE_UNBOUND");
}
const apply = Reflect.apply;
/** Internal fixed Source facade, not a public client or qualification selector. */
export function createSourceStockRawDelegate(): Readonly<{
  rawRequest: Stripe["rawRequest"];
}> {
  if (arguments.length !== 0) stop();
  OWNER.check();
  const client = loadFixedStockClient();
  OWNER.check();
  if (
    !client ||
    typeof client !== "object" ||
    types.isProxy(client) ||
    Object.getPrototypeOf(client) !== Stripe.prototype ||
    Object.prototype.hasOwnProperty.call(client, "rawRequest")
  )
    stop();
  const descriptor = Object.getOwnPropertyDescriptor(
    Stripe.prototype,
    "rawRequest",
  );
  if (
    !descriptor ||
    !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
    typeof descriptor.value !== "function"
  )
    stop();
  const method = descriptor.value as Stripe["rawRequest"];
  OWNER.check();
  return Object.freeze({
    rawRequest(...args: Parameters<Stripe["rawRequest"]>) {
      return apply(method, client, args) as ReturnType<Stripe["rawRequest"]>;
    },
  });
}
