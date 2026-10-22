import type Stripe from "stripe";
import { z } from "zod";
import type { Component, RunCtx } from "../helpers.js";
import type { AccountBalance } from "../connect/payouts.js";
import { getAccountBalance } from "../connect/payouts.js";
import { getCheckoutSessionPageFromStripe } from "../billing/checkoutPages.js";
import { componentRef } from "../webhooks/helpers.js";
import { closureConfigurations } from "./accountCloseOptions.js";
import type { ClosureBlocker } from "../../component/accountClosure/blockers.js";
import type { AppliedConfiguration } from "../../component/core/validators.js";

export type ClosureObservation<T> =
  { status: "observed"; value: T } | { status: "unknown" };
export type AccountClosurePreview = {
  stripeAccountId: string;
  observedAt: number;
  financialCoverage: "unknown";
  account: ClosureObservation<{
    appliedConfigurations: AppliedConfiguration[];
    closed: boolean;
  }>;
  balances: ClosureObservation<AccountBalance[]>;
  openSessions: ClosureObservation<{ sessionIds: string[]; hasMore: boolean }>;
  componentBlockers: ClosureObservation<ClosureBlocker[]>;
  knownBlockers: string[];
  unknownReasons: string[];
};
export type AccountClosurePreviewOptions = {
  stripeAccountId: string;
  sessionLimit?: number;
};
export const accountClosurePreviewOptionsSchema = z
  .object({
    stripeAccountId: z
      .string()
      .regex(/^acct_[A-Za-z0-9_]+$/)
      .max(128),
    sessionLimit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

/** Point-in-time known blockers; never a positive closure authorization. */
export async function previewAccountClosure(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: AccountClosurePreviewOptions,
): Promise<AccountClosurePreview> {
  const opts = accountClosurePreviewOptionsSchema.parse(input);
  const [account, balances, openSessions, componentBlockers] =
    await Promise.all([
      observe(async () => {
        const account = z
          .object({
            id: z.literal(opts.stripeAccountId),
            closed: z.boolean(),
            applied_configurations: closureConfigurations,
          })
          .passthrough()
          .parse(await stripe.v2.core.accounts.retrieve(opts.stripeAccountId));
        return {
          appliedConfigurations: account.applied_configurations,
          closed: account.closed,
        };
      }),
      observe(async () =>
        z
          .array(
            z
              .object({
                available: z.number().int().safe(),
                pending: z.number().int().safe(),
                currency: z.string().regex(/^[a-z]{3}$/),
              })
              .strict(),
          )
          .parse(
            await getAccountBalance(stripe, {
              stripeAccountId: opts.stripeAccountId,
            }),
          ),
      ),
      observe(async () => {
        const page = await getCheckoutSessionPageFromStripe(stripe, {
          customerAccount: opts.stripeAccountId,
          status: "open",
          limit: opts.sessionLimit ?? 25,
        });
        return {
          sessionIds: page.page.map((session) => session.id),
          hasMore: page.hasMore,
        };
      }),
      observe(async () =>
        z
          .array(
            z.enum(["usageCorrections", "prepaidCredits", "usageEnrollment"]),
          )
          .max(3)
          .parse(
            await ctx.runQuery(
              componentRef(component, "accountClosure/queries/knownBlockers"),
              { stripeAccountId: opts.stripeAccountId },
            ),
          ),
      ),
    ]);
  const knownBlockers: string[] =
    componentBlockers.status === "observed" ? [...componentBlockers.value] : [];
  const unknownReasons = ["financial_coverage_unknown"];
  if (account.status === "unknown") unknownReasons.push("account_unavailable");
  if (balances.status === "unknown")
    unknownReasons.push("balances_unavailable");
  else if (
    balances.value.some((item) => item.available !== 0 || item.pending !== 0)
  )
    knownBlockers.push("nonzero_balance");
  if (openSessions.status === "unknown")
    unknownReasons.push("open_sessions_unavailable");
  else {
    if (openSessions.value.sessionIds.length)
      knownBlockers.push("open_checkout_sessions");
    if (openSessions.value.hasMore)
      unknownReasons.push("open_sessions_truncated");
  }
  if (componentBlockers.status === "unknown")
    unknownReasons.push("component_blockers_unavailable");
  return {
    stripeAccountId: opts.stripeAccountId,
    observedAt: Date.now(),
    financialCoverage: "unknown",
    account,
    balances,
    openSessions,
    componentBlockers,
    knownBlockers,
    unknownReasons,
  };
}

async function observe<T>(
  read: () => Promise<T>,
): Promise<ClosureObservation<T>> {
  try {
    return { status: "observed", value: await read() };
  } catch {
    return { status: "unknown" };
  }
}
