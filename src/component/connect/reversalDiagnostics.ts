import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { wedgedReversalClaimValidator } from "./validators.js";

export const listWedgedReversalClaimsDefinition = {
  args: {},
  returns: v.array(wedgedReversalClaimValidator),
  handler: async (ctx: QueryCtx) => {
    // Collect the wedged legs first.
    const wedged: Doc<"transfers">[] = [];
    for await (const tr of ctx.db.query("transfers")) {
      const tracked =
        tr.role === "affiliate"
          ? await ctx.db
              .query("affiliateObligations")
              .withIndex("by_transfer", (q) =>
                q.eq("stripeTransferId", tr.stripeTransferId),
              )
              .unique()
          : null;
      if (tracked?.accounted) continue;
      if ((tr.reversalClaimedAmount ?? 0) > (tr.reversedAmount ?? 0)) {
        wedged.push(tr);
      }
    }
    if (wedged.length === 0) return [];

    const wedgedIds = new Set(wedged.map((t) => t.stripeTransferId));

    // Index the ops that hold an unexecuted slice on a wedged leg. A slice is
    // unexecuted when its `to` exceeds the leg's confirmed `reversedAmount`.
    const confirmedById = new Map(
      wedged.map((t) => [t.stripeTransferId, t.reversedAmount ?? 0]),
    );
    const blockersByLeg = new Map<
      string,
      { operationId: string; from: number; to: number }[]
    >();
    for await (const op of ctx.db.query("transferReversalOps")) {
      for (const s of op.slices) {
        if (!wedgedIds.has(s.stripeTransferId)) continue;
        if (s.to <= (confirmedById.get(s.stripeTransferId) ?? 0)) continue;
        const list = blockersByLeg.get(s.stripeTransferId) ?? [];
        list.push({ operationId: op.operationId, from: s.from, to: s.to });
        blockersByLeg.set(s.stripeTransferId, list);
      }
    }

    return wedged.map((t) => ({
      stripeTransferId: t.stripeTransferId,
      sourceChargeId: t.sourceChargeId,
      amount: t.amount,
      reversedAmount: t.reversedAmount ?? 0,
      reversalClaimedAmount: t.reversalClaimedAmount ?? 0,
      blockingOps: (blockersByLeg.get(t.stripeTransferId) ?? []).sort(
        (a, b) => a.from - b.from,
      ),
    }));
  },
};
