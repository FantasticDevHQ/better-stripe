import Stripe from "stripe";
import { SingleAttemptHttpClient } from "./singleAttemptHttpClient.js";

/** No fetch redirect replay, plus the Stripe closed-connection retry guard. */
export function createSingleAttemptHttpClient(): Stripe.HttpClient {
  return new SingleAttemptHttpClient(
    Stripe.createFetchHttpClient((input, init) =>
      fetch(input, { ...init, redirect: "error" }),
    ),
  );
}
