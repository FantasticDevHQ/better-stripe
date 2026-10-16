import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { z } from "zod";
import {
  assertOwner,
  assertSelector,
} from "../component/financialOwnership/helpers.js";
import type {
  legDoc,
  sourceDoc,
} from "../component/financialObservations/schema.js";
import { InvoiceReadClient } from "./invoiceReads.js";
import type { Component, RunCtx } from "./helpers.js";
import { runMutationOrThrow } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";

export type FinancialSourceObservation = Infer<typeof sourceDoc>;
export type FinancialSourceLeg = Infer<typeof legDoc>;
export type FinancialSourceResult = {
  coverage: "unknown";
  observation: FinancialSourceObservation | null;
};
export type FinancialObservationPage = PaginationResult<FinancialSourceLeg> & {
  coverage: "unknown";
  generation: number | null;
};
export type FinancialObservationOwner = { userId: string; orgId?: string };
const pagination = z
  .object({
    numItems: z.number().int().min(1).max(100),
    cursor: z.string().nullable(),
    id: z.number().optional(),
    endCursor: z.string().nullable().optional(),
    maximumRowsRead: z.number().optional(),
    maximumBytesRead: z.number().optional(),
  })
  .strict();
/** Trusted host diagnostics only; neither caller selectors nor exhausted pages authorize closure. */
export class FinancialObservationsClient {
  constructor(private component: Component) {}
  async source(
    ctx: RunCtx,
    input: { allocationId: string },
  ): Promise<FinancialSourceResult> {
    const args = z
      .object({ allocationId: z.string().min(1).max(256) })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "financialObservations/queries/source"),
      args,
    );
  }
  async resume(
    ctx: RunCtx,
    input: { allocationId: string; expectedGeneration: number },
  ): Promise<FinancialSourceResult> {
    const args = z
      .object({
        allocationId: z.string().min(1).max(256),
        expectedGeneration: z
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .parse(input);
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "financialObservations/mutations/resume"),
      args,
    );
  }
  async bucket(
    ctx: RunCtx,
    input: { bucketKey: string; paginationOpts: PaginationOptions },
  ): Promise<FinancialObservationPage> {
    const args = z
      .object({ bucketKey: z.string(), paginationOpts: pagination })
      .strict()
      .parse(input);
    assertSelector(args.bucketKey);
    return ctx.runQuery(
      componentRef(this.component, "financialObservations/queries/bucket"),
      args,
    );
  }
  async owner(
    ctx: RunCtx,
    input: FinancialObservationOwner & { paginationOpts: PaginationOptions },
  ): Promise<FinancialObservationPage> {
    const args = z
      .object({
        userId: z.string(),
        orgId: z.string().optional(),
        paginationOpts: pagination,
      })
      .strict()
      .parse(input);
    assertOwner(args);
    return ctx.runQuery(
      componentRef(this.component, "financialObservations/queries/owner"),
      args,
    );
  }
}
export abstract class FinancialObservationsHost extends InvoiceReadClient {
  readonly financialObservations = new FinancialObservationsClient(
    this.component,
  );
}
