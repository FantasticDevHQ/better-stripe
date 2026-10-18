import { observeInvoiceCorrection } from "./correctionInvoice.js";
import type { UsageInvoiceCorrectionOptions } from "./correctionTerms.js";
import { readCorrectionEvidence } from "./correctionRead.js";
import { scopeSchema, type UsageScope } from "./records.js";
import { componentRef } from "../webhooks/helpers.js";
import type { Doc } from "../../component/_generated/dataModel.js";
import { correctionView } from "./correctionTerms.js";
import type { UsagePeriod } from "./boundaries.js";
import { UsageAllowanceClient } from "./allowanceClient.js";
import type { RunCtx } from "../helpers.js";
import { requestUsageCorrection } from "./correctionProvider.js";
import type { UsageCorrectionOptions } from "./correctionTerms.js";
import type { UsageDeliveryProviderOptions } from "./deliveryProvider.js";
/** Host authenticates and authorizes the actor and original activity before calling. */
export class UsageCorrectionClient extends UsageAllowanceClient {
  async getCorrection(
    ctx: RunCtx,
    input: { scope: UsageScope; eventId: string; correctionId: string },
  ) {
    const row = (await ctx.runQuery(
      componentRef(this.component, "usageCorrections/queries/get"),
      { ...input, scope: scopeSchema.parse(input.scope) },
    )) as Doc<"usageCorrections"> | null;
    return row ? correctionView(row) : null;
  }
  readCorrectionHistory(
    ctx: RunCtx,
    input: {
      scope: UsageScope;
      eventId: string;
      limit: number;
      cursor: string | null;
    },
  ) {
    return readCorrectionEvidence(this.component, ctx, input);
  }
  readCorrectionPeriodHistory(
    ctx: RunCtx,
    input: {
      scope: UsageScope;
      period: UsagePeriod;
      limit: number;
      cursor: string | null;
    },
  ) {
    return readCorrectionEvidence(this.component, ctx, input);
  }
  observeInvoiceCorrection(
    ctx: RunCtx,
    input: UsageInvoiceCorrectionOptions,
    options: UsageDeliveryProviderOptions,
  ) {
    return observeInvoiceCorrection(this.component, ctx, input, options);
  }
  requestCorrection(
    ctx: RunCtx,
    input: UsageCorrectionOptions,
    options: UsageDeliveryProviderOptions = {},
  ) {
    return requestUsageCorrection(this.component, ctx, input, options);
  }
}
