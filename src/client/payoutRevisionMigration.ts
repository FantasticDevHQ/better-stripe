import type { PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { z } from "zod";
import { FinancialObservationsHost } from "./financialObservations.js";
import { runMutationOrThrow, type Component, type RunCtx } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";
import { observationPagination } from "./observationPagination.js";
import type { activationResult } from "../component/payoutRevisionJournal/schema.js";
import type {
  jobDoc,
  resultDoc,
} from "../component/payoutRevisionMigration/schema.js";
export type PayoutRevisionActivation = Infer<typeof activationResult>;
export type PayoutRevisionMigrationState = Infer<typeof jobDoc>;
export type PayoutRevisionMigrationResult = Infer<typeof resultDoc>;
const jobId = z.string().min(1).max(256);
/** Trusted host maintenance only. Authorize every call; completion is not financial coverage. */
export class PayoutRevisionMigrationClient {
  constructor(private component: Component) {}
  activateAccount(
    ctx: RunCtx,
    input: { accountId: string },
  ): Promise<PayoutRevisionActivation> {
    const args = z.object({ accountId: z.string() }).strict().parse(input);
    return runMutationOrThrow(
      ctx,
      componentRef(
        this.component,
        "payoutRevisionJournal/mutations/activateAccount",
      ),
      args,
    );
  }
  begin(
    ctx: RunCtx,
    input: { operationKey: string },
  ): Promise<PayoutRevisionMigrationState> {
    const args = z
      .object({ operationKey: z.string().min(1).max(256) })
      .strict()
      .parse(input);
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "payoutRevisionMigration/mutations/begin"),
      args,
    );
  }
  resume(
    ctx: RunCtx,
    input: { jobId: string; expectedStep: number },
  ): Promise<PayoutRevisionMigrationState> {
    const args = z
      .object({
        jobId,
        expectedStep: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .parse(input);
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "payoutRevisionMigration/mutations/resume"),
      args,
    );
  }
  get(
    ctx: RunCtx,
    input: { jobId: string },
  ): Promise<PayoutRevisionMigrationState | null> {
    const args = z.object({ jobId }).strict().parse(input);
    return ctx.runQuery(
      componentRef(this.component, "payoutRevisionMigration/queries/get"),
      args,
    );
  }
  results(
    ctx: RunCtx,
    input: {
      jobId: string;
      paginationOpts: z.input<typeof observationPagination>;
    },
  ): Promise<PaginationResult<PayoutRevisionMigrationResult>> {
    const args = z
      .object({ jobId, paginationOpts: observationPagination })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "payoutRevisionMigration/queries/results"),
      args,
    );
  }
}
export abstract class PayoutRevisionMigrationHost extends FinancialObservationsHost {
  readonly payoutRevisionMigration = new PayoutRevisionMigrationClient(
    this.component,
  );
}
