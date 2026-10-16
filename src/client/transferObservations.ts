import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { z } from "zod";
import {
  assertOwner,
  assertSelector,
} from "../component/financialOwnership/helpers.js";
import type {
  transferObservationDoc,
  transferBatchDoc,
} from "../component/financialObservations/transferSchema.js";
import type { Component, RunCtx } from "./helpers.js";
import { observationPagination } from "./observationPagination.js";
import { componentRef } from "./webhooks/helpers.js";

export type FinancialTransferObservation = Infer<typeof transferObservationDoc>;
export type FinancialTransferBatch = Infer<typeof transferBatchDoc>;
export type FinancialTransferReadState = {
  coverage: "unknown";
  producerGeneration: number | null;
  hasDeferredWork: boolean;
};
export type FinancialTransferResult = FinancialTransferReadState & {
  observation: FinancialTransferObservation | null;
};
export type FinancialTransferPage = FinancialTransferReadState &
  PaginationResult<FinancialTransferObservation> & {
    generation: number | null;
  };
export type FinancialTransferBatchPage = FinancialTransferReadState &
  PaginationResult<FinancialTransferBatch>;
/** Trusted host diagnostics. Pending batches invalidate historical pages, never financial state. */
export class TransferObservationsClient {
  constructor(protected component: Component) {}
  async transfer(
    ctx: RunCtx,
    input: { transferId: string },
  ): Promise<FinancialTransferResult> {
    const args = z
      .object({ transferId: z.string().min(1).max(256) })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "financialObservations/queries/transfer"),
      args,
    );
  }
  async transferBucket(
    ctx: RunCtx,
    input: { bucketKey: string; paginationOpts: PaginationOptions },
  ): Promise<FinancialTransferPage> {
    const args = z
      .object({ bucketKey: z.string(), paginationOpts: observationPagination })
      .strict()
      .parse(input);
    assertSelector(args.bucketKey);
    return ctx.runQuery(
      componentRef(
        this.component,
        "financialObservations/queries/transferBucket",
      ),
      args,
    );
  }
  async transferOwner(
    ctx: RunCtx,
    input: {
      userId: string;
      orgId?: string;
      paginationOpts: PaginationOptions;
    },
  ): Promise<FinancialTransferPage> {
    const args = z
      .object({
        userId: z.string(),
        orgId: z.string().optional(),
        paginationOpts: observationPagination,
      })
      .strict()
      .parse(input);
    assertOwner(args);
    return ctx.runQuery(
      componentRef(
        this.component,
        "financialObservations/queries/transferOwner",
      ),
      args,
    );
  }
  async transferBatches(
    ctx: RunCtx,
    input: { operationId: string; paginationOpts: PaginationOptions },
  ): Promise<FinancialTransferBatchPage> {
    const args = z
      .object({
        operationId: z.string(),
        paginationOpts: observationPagination,
      })
      .strict()
      .parse(input);
    assertSelector(args.operationId);
    return ctx.runQuery(
      componentRef(
        this.component,
        "financialObservations/queries/transferBatches",
      ),
      args,
    );
  }
}
