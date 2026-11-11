import { invokeNodeConfiguration } from "./renewalConfigurationRuntime.js";
import type { ConfigureRenewalScheduleOptions } from "./renewalConfigurationTypes.js";
import { PaymentSourceClient } from "./paymentSource/client.js";
import type { RunCtx } from "./helpers.js";
import { invokeNodeAttachment } from "./renewalAttachmentRuntime.js";
import type {
  AttachRenewalScheduleOptions,
  RenewalAttachmentActionCtx,
} from "./renewalAttachmentTypes.js";
import {
  readRenewalPriceReplacementContext,
  type ReadRenewalPriceReplacementContextOptions,
} from "./billing/renewalAttach/reader.js";

/** Provider context acquisition inherited by the public server client. */
export abstract class RenewalContextClient extends PaymentSourceClient {
  abstract readonly stripeApiVersion: string;

  /** Explicit single-attempt attachment. Import BetterStripe from the Node entrypoint. */
  attachRenewalSchedule(
    ctx: RenewalAttachmentActionCtx,
    options: AttachRenewalScheduleOptions,
  ) {
    return invokeNodeAttachment(this, ctx, options);
  }

  configureRenewalSchedule(
    ctx: RenewalAttachmentActionCtx,
    options: ConfigureRenewalScheduleOptions,
  ) {
    return invokeNodeConfiguration(this, ctx, options);
  }

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
