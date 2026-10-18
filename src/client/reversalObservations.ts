import type { PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { z } from "zod";
import { PayoutRevisionMigrationHost } from "./payoutRevisionMigration.js";
import { runMutationOrThrow, type Component, type RunCtx } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";
import { observationPagination } from "./observationPagination.js";
import type {
  headerDoc,
  sliceDoc,
  payloadDoc,
} from "../component/reversalObservations/schema.js";
export type ReversalObservation = Infer<typeof headerDoc>;
export type ReversalObservationSlice = Infer<typeof sliceDoc>;
export type ReversalObservationPayload = Infer<typeof payloadDoc>;
export type ReversalObservationState = {
  coverage: "unknown";
  generation: number | null;
  transferGeneration: number | null;
};
export type ReversalObservationResult = ReversalObservationState & {
  observation: ReversalObservation | null;
};
export type ReversalObservationPage<T> = ReversalObservationState &
  PaginationResult<T>;
type PageOptions = z.input<typeof observationPagination>;
const operationId = z.string().min(1).max(256);
/** Trusted host diagnostics only. History and indexed pages never authorize financial actions. */
export class ReversalObservationsClient {
  constructor(private component: Component) {}
  operation(
    ctx: RunCtx,
    input: { operationId: string },
  ): Promise<ReversalObservationResult> {
    const args = z.object({ operationId }).strict().parse(input);
    return ctx.runQuery(
      componentRef(this.component, "reversalObservations/queries/operation"),
      args,
    );
  }
  resume(
    ctx: RunCtx,
    input: {
      operationId: string;
      expectedGeneration: number;
      batchSize?: number;
    },
  ): Promise<ReversalObservationResult> {
    const args = z
      .object({
        operationId,
        expectedGeneration: z
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER),
        batchSize: z.number().int().min(1).max(20).optional(),
      })
      .strict()
      .parse(input);
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "reversalObservations/mutations/resume"),
      args,
    );
  }
  slices(
    ctx: RunCtx,
    input: { operationId: string; paginationOpts: PageOptions },
  ): Promise<ReversalObservationPage<ReversalObservationSlice>> {
    const args = z
      .object({ operationId, paginationOpts: observationPagination })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "reversalObservations/queries/slices"),
      args,
    );
  }
  bucket(
    ctx: RunCtx,
    input: { bucketKey: string; paginationOpts: PageOptions },
  ): Promise<ReversalObservationPage<ReversalObservationSlice>> {
    const args = z
      .object({ bucketKey: z.string(), paginationOpts: observationPagination })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "reversalObservations/queries/bucket"),
      args,
    );
  }
  owner(
    ctx: RunCtx,
    input: { userId: string; orgId?: string; paginationOpts: PageOptions },
  ): Promise<ReversalObservationPage<ReversalObservationSlice>> {
    const args = z
      .object({
        userId: z.string().min(1),
        orgId: z.string().min(1).optional(),
        paginationOpts: observationPagination,
      })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "reversalObservations/queries/owner"),
      args,
    );
  }
  history(
    ctx: RunCtx,
    input: {
      selector: "operationId" | "sourceChargeId";
      value: string;
      paginationOpts: PageOptions;
    },
  ): Promise<ReversalObservationPage<ReversalObservation>> {
    const args = z
      .object({
        selector: z.enum(["operationId", "sourceChargeId"]),
        value: z.string(),
        paginationOpts: observationPagination,
      })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "reversalObservations/queries/history"),
      args,
    );
  }
  payload(
    ctx: RunCtx,
    input: { operationId: string; version: "original" | "latest" },
  ): Promise<
    ReversalObservationState & { payload: ReversalObservationPayload | null }
  > {
    const args = z
      .object({ operationId, version: z.enum(["original", "latest"]) })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "reversalObservations/queries/payload"),
      args,
    );
  }
}
export abstract class ReversalObservationsHost extends PayoutRevisionMigrationHost {
  readonly reversalObservations = new ReversalObservationsClient(
    this.component,
  );
}
