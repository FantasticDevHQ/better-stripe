import {
  reconcileAffiliatePayout,
  completeAffiliatePayout,
} from "./affiliateRecovery/payoutGate.js";
import { verifiedLegacyReview } from "./affiliateRecovery/review.js";
import { runMutationOrThrow } from "./helpers.js";
import { createPayout } from "./connect/payouts.js";
import type Stripe from "stripe";
import type { PaginationOptions } from "convex/server";
import type { Component, RunCtx } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";
import { reconcileObligation } from "./affiliateRecovery/engine.js";
import type {
  RecoveryObligation,
  RecoveryOperation,
} from "./affiliateRecovery/provider.js";
import type { Doc } from "../component/_generated/dataModel.js";
export type AffiliateRecoveryObligation = RecoveryObligation;
export type AffiliateRecoveryOperation = RecoveryOperation;
export type AffiliateRecoveryBalance = Doc<"affiliateRecoveryBalances">;
export type AffiliateRecoverySnapshot = {
  balance: AffiliateRecoveryBalance | null;
  obligations: {
    page: RecoveryObligation[];
    continueCursor: string;
    isDone: boolean;
  };
};
/** Server API. Host must authorize account ownership and operator retries. */
export class AffiliateRecoveryClient {
  constructor(
    private readonly component: Component,
    private readonly provider: () => Stripe,
  ) {}
  async snapshot(
    ctx: RunCtx,
    opts: {
      affiliateAccountId: string;
      currency: string;
      paginationOpts: PaginationOptions;
    },
  ): Promise<AffiliateRecoverySnapshot> {
    return ctx.runQuery(
      componentRef(
        this.component,
        "affiliateRecovery/queries/recoverySnapshot",
      ),
      opts,
    ) as Promise<AffiliateRecoverySnapshot>;
  }
  async obligation(
    ctx: RunCtx,
    opts: { obligationId: string },
  ): Promise<RecoveryObligation | null> {
    return ctx.runQuery(
      componentRef(this.component, "affiliateRecovery/queries/getObligation"),
      opts,
    ) as Promise<RecoveryObligation | null>;
  }
  async history(
    ctx: RunCtx,
    opts: { obligationId: string; paginationOpts: PaginationOptions },
  ) {
    return ctx.runQuery(
      componentRef(
        this.component,
        "affiliateRecovery/queries/operationHistory",
      ),
      opts,
    ) as Promise<{
      page: RecoveryOperation[];
      continueCursor: string;
      isDone: boolean;
    }>;
  }
  async reviewLegacy(
    ctx: RunCtx,
    opts: {
      obligationId: string;
      reversalIds: string[];
      restorationTransferIds?: string[];
      note: string;
    },
  ) {
    const row = await this.obligation(ctx, opts);
    if (!row) throw new Error("Affiliate obligation not found.");
    const review = await verifiedLegacyReview(this.provider(), row, opts);
    await runMutationOrThrow(
      ctx,
      componentRef(this.component, "affiliateRecovery/mutations/reviewLegacy"),
      review,
    );
    return this.obligation(ctx, opts);
  }
  async retry(ctx: RunCtx, opts: { obligationId: string }) {
    return reconcileObligation(
      this.provider(),
      this.component,
      ctx,
      opts.obligationId,
    );
  }
  async reconcilePayouts(
    ctx: RunCtx,
    opts: { paginationOpts: PaginationOptions; state: "pending" | "unknown" },
  ) {
    const page = (await ctx.runQuery(
      componentRef(this.component, "affiliatePayouts/queries/pendingPayouts"),
      opts,
    )) as {
      page: Doc<"affiliatePayoutReleases">[];
      continueCursor: string;
      isDone: boolean;
    };
    for (const row of page.page) {
      try {
        // Confirm money already moved even when new debt blocks another attempt.
        const receipt = await reconcileAffiliatePayout(this.provider(), row);
        if (receipt) {
          await completeAffiliatePayout(
            this.component,
            ctx,
            row.operationKey,
            "submitted",
            receipt,
          );
          continue;
        }
        await createPayout(
          this.provider(),
          ctx,
          {
            stripeAccountId: row.affiliateAccountId,
            currency: row.currency,
            amount: row.amount,
            minimumAmount: row.minimumAmount,
            idempotencyKey: row.operationKey,
          },
          this.component,
        );
      } catch {
        /* The payout gate retains the durable failure/unknown outcome. */
      }
    }
    return page;
  }
  /** Run from a host cron for both pending and unknown outcomes. */
  async reconcilePending(
    ctx: RunCtx,
    opts: { paginationOpts: PaginationOptions; state: "pending" | "unknown" },
  ) {
    const page = (await ctx.runQuery(
      componentRef(
        this.component,
        "affiliateRecovery/queries/pendingOperations",
      ),
      opts,
    )) as {
      page: RecoveryOperation[];
      continueCursor: string;
      isDone: boolean;
    };
    const results = [];
    for (const op of page.page)
      results.push(await this.retry(ctx, { obligationId: op.obligationId }));
    return { ...page, results };
  }
}
export {
  affiliateSnapshotValidator,
  affiliateObligationValidator,
  affiliateOperationValidator,
} from "./affiliateRecovery/validators.js";
