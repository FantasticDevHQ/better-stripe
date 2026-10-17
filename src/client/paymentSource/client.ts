import { CatalogClient } from "../products/catalogClient.js";
import type { RunCtx } from "../helpers.js";
import { resolveVerifiedPaymentSource } from "./resolver.js";
import type { VerifiedPaymentSourceOptions } from "./contracts.js";

export abstract class PaymentSourceClient extends CatalogClient {
  async getVerifiedPaymentSource(
    _ctx: RunCtx,
    opts: VerifiedPaymentSourceOptions,
  ) {
    return resolveVerifiedPaymentSource(this.stripe(), opts);
  }
}
