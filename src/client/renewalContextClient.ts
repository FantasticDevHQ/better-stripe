import { PaymentSourceClient } from "./paymentSource/client.js";
import type { RunCtx } from "./helpers.js";
import {
  readRenewalPriceReplacementContext,
  type ReadRenewalPriceReplacementContextOptions,
} from "./billing/renewalAttach/reader.js";

/** Provider context acquisition inherited by the public server client. */
export abstract class RenewalContextClient extends PaymentSourceClient {
  abstract readonly stripeApiVersion: string;

  /** Context only. Hosts authorize exact selectors; no attachment occurs. */
  async readRenewalPriceReplacementContext(
    _ctx: RunCtx,
    opts: ReadRenewalPriceReplacementContextOptions,
  ) {
    return readRenewalPriceReplacementContext(
      this.stripe({ singleAttempt: true }),
      opts,
      this.stripeApiVersion,
    );
  }
}
