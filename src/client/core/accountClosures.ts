import type { Infer } from "convex/values";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { closureDoc } from "../../component/accountClosure/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

export type StripeAccountClosure = Infer<typeof closureDoc>;

/** Host must authenticate the actor and compare both user and organization ownership. */
export function getClosedAccountByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<StripeAccountClosure | null> {
  return ctx.runQuery(
    componentRef(
      component,
      "accountClosure/queries/getClosedAccountByStripeId",
    ),
    opts,
  );
}

/** Personal closed accounts only. A caller-supplied userId is not authentication. */
export function listClosedAccountsByUserId(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string; paginationOpts: PaginationOptions },
): Promise<PaginationResult<StripeAccountClosure>> {
  return ctx.runQuery(
    componentRef(
      component,
      "accountClosure/queries/listClosedAccountsByUserId",
    ),
    opts,
  );
}
