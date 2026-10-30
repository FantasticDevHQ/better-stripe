import assert from "node:assert/strict";
import type Stripe from "stripe";
import { data } from "./configurePreflightControls.js";
import type { WriteObservations } from "./configureWriteObservations.js";
import type { configureWriteBarriers } from "./configureWriteBarriers.js";

/** TEST-only extraction: original client/method/receiver/args/Promise remain unchanged. */
export function captureWriteTestDelegate(
  client: Stripe,
  method: Stripe["rawRequest"],
  current: () => WriteObservations,
  writeGates: ReturnType<typeof configureWriteBarriers>,
  apiVersion: string,
) {
  return Object.freeze({
    rawRequest(...args: unknown[]) {
      const state = current();
      state.trace.push("delegate:" + String(args[0]));
      state.delegateArgs.push(args);
      const options = data(args[3]);
      assert.equal(options.apiVersion, apiVersion);
      assert.equal(options.maxNetworkRetries, 0);
      assert.equal(
        Object.prototype.hasOwnProperty.call(options, "stripeAccount"),
        false,
      );
      const promise = Reflect.apply(method, client, args) as Promise<unknown>;
      state.originalPromises.push(promise);
      writeGates.pending.push(
        promise.then(
          () => {},
          () => {},
        ),
      );
      return promise;
    },
  });
}
