import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { z } from "zod";
import {
  assertOwner,
  assertSelector,
} from "../component/financialOwnership/helpers.js";
import type { registrationDoc } from "../component/financialOwnership/schema.js";
import { FinancialObservationsHost } from "./financialObservations.js";
import type { Component, RunCtx } from "./helpers.js";
import { runMutationOrThrow } from "./helpers.js";
import { componentRef } from "./webhooks/helpers.js";

export type FinancialOwnershipRegistration = Infer<typeof registrationDoc>;
export type FinancialOwnershipResult =
  | {
      status: "registered";
      coverage: "unknown";
      registration: FinancialOwnershipRegistration;
    }
  | { status: "unknown"; coverage: "unknown" };
export type FinancialOwnershipOwner = { userId: string; orgId?: string };
export type RegisterFinancialOwnershipOptions = FinancialOwnershipOwner & {
  bucketKey: string;
} & (
    | { kind: "stripe_account" }
    | { kind: "logical"; source: { integration: string; recordId: string } }
  );
export type FinancialOwnershipPage =
  PaginationResult<FinancialOwnershipRegistration> & {
    coverage: "unknown";
    generation: number;
  };
const owner = { userId: z.string(), orgId: z.string().optional() };
const registrationInput = z.discriminatedUnion("kind", [
  z
    .object({
      ...owner,
      bucketKey: z.string(),
      kind: z.literal("stripe_account"),
    })
    .strict(),
  z
    .object({
      ...owner,
      bucketKey: z.string(),
      kind: z.literal("logical"),
      source: z
        .object({ integration: z.string(), recordId: z.string() })
        .strict(),
    })
    .strict(),
]);

/** Trusted host-server provenance only. Authenticate the actor and verify logical source ownership first. */
export class FinancialOwnershipClient {
  constructor(private component: Component) {}
  async register(
    ctx: RunCtx,
    input: RegisterFinancialOwnershipOptions,
  ): Promise<Extract<FinancialOwnershipResult, { status: "registered" }>> {
    const args = registrationInput.parse(input);
    assertOwner(args);
    assertSelector(args.bucketKey);
    if (args.kind === "logical") {
      assertSelector(args.source.integration);
      assertSelector(args.source.recordId);
    }
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "financialOwnership/mutations/register"),
      args,
    );
  }
  async lookup(
    ctx: RunCtx,
    input: { bucketKey: string },
  ): Promise<FinancialOwnershipResult> {
    const args = z.object({ bucketKey: z.string() }).strict().parse(input);
    assertSelector(args.bucketKey);
    return ctx.runQuery(
      componentRef(this.component, "financialOwnership/queries/lookup"),
      args,
    );
  }
  async discover(
    ctx: RunCtx,
    input: FinancialOwnershipOwner & { paginationOpts: PaginationOptions },
  ): Promise<FinancialOwnershipPage> {
    const args = z
      .object({
        ...owner,
        paginationOpts: z
          .object({
            numItems: z.number().int().min(1).max(100),
            cursor: z.string().nullable(),
            id: z.number().optional(),
            endCursor: z.string().nullable().optional(),
            maximumRowsRead: z.number().optional(),
            maximumBytesRead: z.number().optional(),
          })
          .strict(),
      })
      .strict()
      .parse(input);
    assertOwner(args);
    return ctx.runQuery(
      componentRef(this.component, "financialOwnership/queries/discover"),
      args,
    );
  }
}
/** Extends the existing facade without expanding its frozen entry-file budget. */
export abstract class FinancialOwnershipHost extends FinancialObservationsHost {
  readonly financialOwnership = new FinancialOwnershipClient(this.component);
}
