import type { ComponentApi } from "../component/_generated/component.js";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Component, RunCtx } from "./helpers.js";
import type { PayoutStatus } from "../component/connect/validators.js";
import type {
  StripeComponentPayout,
  StripeComponentProduct,
  StripeComponentPrice,
} from "./types/documents.js";
import { componentRef } from "./webhooks/helpers.js";
/** Shared component readers inherited by BetterStripe. */
export class ReadContractClient {
  constructor(public component: Component) {}
  async paginateProducts(
    ctx: RunCtx,
    opts: {
      accountId?: string;
      active?: boolean;
      paginationOpts: PaginationOptions;
    },
  ): Promise<PaginationResult<StripeComponentProduct>> {
    return ctx.runQuery(
      componentRef(this.component, "products/queries/paginateProducts"),
      opts,
    );
  }
  async paginatePrices(
    ctx: RunCtx,
    opts: {
      productId?: string;
      active?: boolean;
      paginationOpts: PaginationOptions;
    },
  ): Promise<PaginationResult<StripeComponentPrice>> {
    return ctx.runQuery(
      componentRef(this.component, "products/queries/paginatePrices"),
      opts,
    );
  }
  async paginatePayouts(
    ctx: RunCtx,
    opts: {
      accountId: string;
      status?: PayoutStatus;
      paginationOpts: PaginationOptions;
    },
  ): Promise<PaginationResult<StripeComponentPayout>> {
    return ctx.runQuery(
      componentRef(this.component, "connect/queries/paginatePayouts"),
      opts,
    );
  }

  async getAccountEarningsByCurrency(
    ctx: RunCtx,
    opts: { destinationAccountId: string; previewLimit?: number },
  ): Promise<{
    totals: {
      currency: string;
      gross: number;
      reversed: number;
      net: number;
      transferCount: number;
    }[];
    transfers: ComponentApi["connect"]["queries"]["getAccountEarningsByCurrency"]["_returnType"]["transfers"];
  }> {
    return ctx.runQuery(
      componentRef(
        this.component,
        "connect/queries/getAccountEarningsByCurrency",
      ),
      opts,
    );
  }
  async getAccountPayoutsByCurrency(
    ctx: RunCtx,
    opts: { accountId: string; previewLimit?: number },
  ): Promise<{
    totals: { currency: string; paidOut: number; payoutCount: number }[];
    payouts: StripeComponentPayout[];
  }> {
    return ctx.runQuery(
      componentRef(
        this.component,
        "connect/queries/getAccountPayoutsByCurrency",
      ),
      opts,
    );
  }
}
