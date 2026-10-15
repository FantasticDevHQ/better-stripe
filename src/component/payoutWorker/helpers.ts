import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { validateScope } from "../payoutPolicy/helpers.js";
export function validate(args: {
  accountId: string;
  ownerKey: string;
  currency: string;
}) {
  validateScope(args);
  if (!/^[a-z]{3}$/.test(args.currency))
    throw new Error("Invalid worker currency.");
}
export async function readJob(
  ctx: MutationCtx | QueryCtx,
  args: { accountId: string; ownerKey: string; currency: string },
) {
  validate(args);
  const job = await ctx.db
    .query("payoutWorkerJobs")
    .withIndex("by_account_currency", (q) =>
      q.eq("accountId", args.accountId).eq("currency", args.currency),
    )
    .unique();
  if (job && job.ownerKey !== args.ownerKey)
    throw new Error("Payout worker owner does not match.");
  return job;
}
export function pageSize(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 25)
    throw new Error("Invalid worker page size.");
}
