import type Stripe from "stripe";
import type { Component, RunCtx } from "./helpers.js";
import type { FeeOverride, PlatformFeeConfig } from "./types.js";
import type { CreateCheckoutSessionOptions } from "./billing/checkoutOptions.js";
import {
  prepareCheckoutSession,
  executePreparedCheckoutSession,
} from "./billing/preparedCheckout.js";

/** Server-only request preparation and execution, without a browser-owned money API. */
export class CheckoutRequestClient {
  constructor(
    private component: Component,
    private provider: () => Stripe,
    private resolveFee: (fee?: FeeOverride) => PlatformFeeConfig | undefined,
    private descriptor?: string,
  ) {}
  prepare(ctx: RunCtx, opts: CreateCheckoutSessionOptions) {
    const { fee, ...rest } = opts;
    return prepareCheckoutSession(this.provider(), this.component, ctx, {
      ...rest,
      feeConfig:
        opts.destinationAccountId || opts.split?.length
          ? this.resolveFee(fee)
          : undefined,
      defaultStatementDescriptorSuffix: this.descriptor,
    });
  }
  execute(
    ctx: RunCtx,
    args: Parameters<typeof executePreparedCheckoutSession>[3],
  ) {
    return executePreparedCheckoutSession(
      this.provider(),
      this.component,
      ctx,
      args,
    );
  }
}
