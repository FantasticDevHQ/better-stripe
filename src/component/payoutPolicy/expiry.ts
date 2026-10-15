import type { MutationCtx } from "../_generated/server.js";
import { readPolicy } from "./helpers.js";
type Scope = { accountId: string; ownerKey: string };
export async function beginHoldingExpiry(ctx: MutationCtx, args: Scope) {
  const p = await readPolicy(ctx, args);
  if (
    !p ||
    p.mode !== "custom" ||
    !p.holdDeadline ||
    p.holdDeadline > Date.now()
  )
    throw new Error("A due custom holding deadline is required.");
  if (p.holdingExpiry?.deadline === p.holdDeadline) return p;
  if (p.holdingExpiry && p.holdingExpiry.status !== "no_held_balance")
    throw new Error("Previous holding expiry recovery is unresolved.");
  await ctx.db.patch("payoutPolicies", p._id, {
    holdingExpiry: { deadline: p.holdDeadline, status: "unverified" },
  });
  return (await ctx.db.get("payoutPolicies", p._id))!;
}
export async function observeHoldingExpiry(
  ctx: MutationCtx,
  args: Scope & {
    expectedRevision: number;
    deadline: number;
    observedAt: number;
    balances: { currency: string; available: number; pending: number }[];
  },
) {
  const p = await readPolicy(ctx, args);
  if (
    !p ||
    p.revision !== args.expectedRevision ||
    p.mode !== "stripe_managed" ||
    p.status !== "ready" ||
    p.holdingExpiry?.deadline !== args.deadline ||
    p.holdDeadline !== args.deadline
  )
    throw new Error("Holding expiry recovery changed.");
  if (
    !Number.isSafeInteger(args.observedAt) ||
    args.observedAt > Date.now() ||
    args.observedAt < Date.now() - 30000 ||
    new Set(args.balances.map((b) => b.currency)).size !==
      args.balances.length ||
    args.balances.some(
      (b) =>
        !/^[a-z]{3}$/.test(b.currency) ||
        !Number.isSafeInteger(b.available) ||
        !Number.isSafeInteger(b.pending),
    )
  )
    throw new Error("Invalid or stale holding expiry balance observation.");
  const unresolved = await Promise.all(
    (["reserved", "submitted"] as const).map((status) =>
      ctx.db
        .query("payoutReleaseClaims")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", args.accountId).eq("status", status),
        )
        .first(),
    ),
  );
  const status = unresolved.some(Boolean)
    ? ("claims_unresolved" as const)
    : args.balances.some((b) => b.available !== 0 || b.pending !== 0)
      ? ("balance_remaining" as const)
      : ("no_held_balance" as const);
  await ctx.db.patch("payoutPolicies", p._id, {
    holdingExpiry: {
      deadline: args.deadline,
      observedAt: args.observedAt,
      balances: args.balances,
      status,
    },
    // Retain due discovery until both provider balances and durable claims clear.
    holdDeadline: status === "no_held_balance" ? undefined : args.deadline,
  });
  return (await ctx.db.get("payoutPolicies", p._id))!;
}
