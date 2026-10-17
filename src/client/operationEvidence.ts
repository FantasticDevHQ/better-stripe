import type { Infer } from "convex/values";
import type { PaginationOptions, PaginationResult } from "convex/server";
import { z } from "zod";
import type {
  captureResult,
  headerDoc,
  headerResult,
  payloadDoc,
  payloadResult,
} from "../component/operationEvidence/schema.js";
import { runMutationOrThrow, type Component, type RunCtx } from "./helpers.js";
import { observationPagination } from "./observationPagination.js";
import { componentRef } from "./webhooks/helpers.js";

export type OperationEvidenceHeader = Infer<typeof headerDoc>;
export type OperationEvidencePayload = Infer<typeof payloadDoc>;
export type OperationEvidenceHeaderResult = Infer<typeof headerResult>;
export type OperationEvidencePayloadResult = Infer<typeof payloadResult>;
export type OperationEvidenceCaptureResult = Infer<typeof captureResult>;
export type OperationEvidencePage =
  PaginationResult<OperationEvidenceHeader> & {
    coverage: "unknown";
    evidenceGeneration: number | null;
  };
const headerInput = z.object({ headerId: z.string().min(1).max(256) }).strict();

/** Trusted-host evidence maintenance/readers. No financial or provider operation. */
export class OperationEvidenceClient {
  constructor(private component: Component) {}
  async capture(
    ctx: RunCtx,
    input: { sourceId: string },
  ): Promise<OperationEvidenceCaptureResult> {
    const args = z
      .object({ sourceId: z.string().min(1).max(256) })
      .strict()
      .parse(input);
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "operationEvidence/mutations/capture"),
      args,
    );
  }
  async headers(
    ctx: RunCtx,
    input: { paginationOpts: PaginationOptions & { id?: number } },
  ): Promise<OperationEvidencePage> {
    const args = z
      .object({ paginationOpts: observationPagination })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "operationEvidence/queries/headers"),
      args,
    );
  }
  async original(
    ctx: RunCtx,
    input: { headerId: string },
  ): Promise<OperationEvidencePayloadResult> {
    return ctx.runQuery(
      componentRef(this.component, "operationEvidence/queries/original"),
      headerInput.parse(input),
    );
  }
  async latest(
    ctx: RunCtx,
    input: { headerId: string },
  ): Promise<OperationEvidencePayloadResult> {
    return ctx.runQuery(
      componentRef(this.component, "operationEvidence/queries/latest"),
      headerInput.parse(input),
    );
  }
  async resolve(
    ctx: RunCtx,
    input: { selector: "operationId" | "sourceChargeId"; value: string },
  ): Promise<OperationEvidenceHeaderResult> {
    // Financial selectors are schema-admitted strings, not bounded account/user IDs.
    const args = z
      .object({
        selector: z.enum(["operationId", "sourceChargeId"]),
        value: z.string(),
      })
      .strict()
      .parse(input);
    return ctx.runQuery(
      componentRef(this.component, "operationEvidence/queries/resolve"),
      args,
    );
  }
}
