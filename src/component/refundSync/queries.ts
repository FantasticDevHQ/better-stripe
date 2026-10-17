import { query } from "../_generated/server.js";
import { routingInput, routingResult } from "./validators.js";
import { refundRouting } from "./routing.js";

/** Trusted-host routing proof only; this does not establish seller dispatch authority. */
export const routing = query({
  args: routingInput,
  returns: routingResult,
  handler: refundRouting,
});
