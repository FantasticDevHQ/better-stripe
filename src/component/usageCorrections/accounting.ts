import type { MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { creditAllocations } from "../usageCredits/reservations.js";
import { account, history as creditHistory } from "../usageCredits/helpers.js";
import {
  policyRow,
  history as allowanceHistory,
} from "../usageAllowance/helpers.js";
/** Called only for a full proven cancellation, in the same transaction as the terminal receipt. */
export async function restore(
  ctx: MutationCtx,
  correction: Doc<"usageCorrections">,
  event: Doc<"usageEvents">,
) {
  if (!event.reservationId) return;
  const reservation = await ctx.db.get(
    "usageReservations",
    event.reservationId,
  );
  if (
    !reservation ||
    reservation.state !== "committed" ||
    reservation.eventId !== event._id ||
    reservation.scopeKey !== correction.scopeKey ||
    reservation.scaledQuantity !== correction.scaledQuantity
  )
    throw new Error("Correction reservation provenance mismatch");
  if (reservation.accountingKind === "allowance") {
    const policy = await policyRow(ctx, reservation.accountKey!);
    if (!policy || BigInt(policy.consumed) < BigInt(correction.scaledQuantity))
      throw new Error("Correction allowance backing unavailable");
    await ctx.db.patch("usageAllowancePolicies", policy._id, {
      consumed: (
        BigInt(policy.consumed) - BigInt(correction.scaledQuantity)
      ).toString(),
    });
    await allowanceHistory(ctx, policy, "correction", {
      correctionKey: correction.key,
      eventId: event._id,
      scaledQuantity: correction.scaledQuantity,
      cashCollection: "none",
    });
  } else if (reservation.accountingKind === "prepaid") {
    const ledger = await account(ctx, reservation.accountKey!);
    if (ledger.closed || ledger.frozenReason)
      throw new Error("Correction credit account requires reconciliation");
    const allocations = creditAllocations.parse(
      JSON.parse(reservation.allocationsJson!),
    );
    for (const allocation of allocations) {
      const grant = await ctx.db.get(
        "usageCreditGrants",
        allocation.grantId as import("../_generated/dataModel.js").Id<"usageCreditGrants">,
      );
      if (
        !grant ||
        grant.accountKey !== ledger.key ||
        grant.frozen ||
        grant.nativeExpired ||
        (grant.expiresAt !== null && grant.expiresAt <= Date.now() / 1000) ||
        BigInt(grant.consumed) < BigInt(allocation.quantity)
      )
        throw new Error("Correction original credit backing unavailable");
      await ctx.db.patch("usageCreditGrants", grant._id, {
        consumed: (
          BigInt(grant.consumed) - BigInt(allocation.quantity)
        ).toString(),
        available: (
          BigInt(grant.available) + BigInt(allocation.quantity)
        ).toString(),
      });
    }
    await creditHistory(ctx, ledger.key, "correction", correction.key, {
      eventId: event._id,
      allocations,
      cashCollection: "none",
    });
  }
}
