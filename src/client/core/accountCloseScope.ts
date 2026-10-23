import { z } from "zod";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { CurrentClosureOwner } from "../../component/accountClosure/queries.js";
import type { StripeAccountClosure } from "./accountClosures.js";
import {
  closureConfigurations,
  closeAccountOptionsSchema,
  type CloseAccountOptions,
} from "./accountCloseOptions.js";

export function confirmedClosureScope(
  opts: CloseAccountOptions,
  closure: StripeAccountClosure,
) {
  const expected =
    closeAccountOptionsSchema.parse(opts).expectedAppliedConfigurations;
  const original = closureConfigurations.safeParse(
    closure.appliedConfigurations,
  );
  if (
    !expected ||
    !original.success ||
    closure.stripeAccountId !== opts.stripeAccountId ||
    (!closure.userId && !closure.orgId) ||
    !sameScope(expected, original.data)
  )
    throw new Error(
      "Account closure original scope does not match confirmation",
    );
  return expected;
}

/** Point-in-time scope observation, not financial clearance or provider-side fencing. */
export async function guardedAccountIsClosed(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: CloseAccountOptions,
  closure: StripeAccountClosure,
) {
  const expected = confirmedClosureScope(opts, closure);
  const current = z
    .object({
      id: z.literal(opts.stripeAccountId),
      closed: z.boolean(),
      applied_configurations: closureConfigurations.optional(),
    })
    .passthrough()
    .parse(await stripe.v2.core.accounts.retrieve(opts.stripeAccountId));
  const account: CurrentClosureOwner = await ctx.runQuery(
    componentRef(component, "accountClosure/queries/currentOwner"),
    { stripeAccountId: opts.stripeAccountId },
  );
  if (
    account.status === "ambiguous" ||
    (account.status === "unique" &&
      (account.userId !== closure.userId || account.orgId !== closure.orgId))
  )
    throw new Error("Account closure original ownership changed or is unknown");
  // Terminal account state may clear roles. This observation does not attribute its cause.
  if (current.closed) return true;
  if (account.status !== "unique")
    throw new Error("Account closure current ownership is unavailable");
  if (
    !current.applied_configurations ||
    !sameScope(expected, current.applied_configurations)
  )
    throw new Error("Account closure provider scope changed or is unknown");
  return false;
}

function sameScope(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

export function assertGuardedCloseAcknowledgement(
  value: unknown,
  stripeAccountId: string,
) {
  z.object({ id: z.literal(stripeAccountId), closed: z.literal(true) })
    .passthrough()
    .parse(value);
}
