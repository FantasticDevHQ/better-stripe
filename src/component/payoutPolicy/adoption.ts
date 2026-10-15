import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import type { adoptionProof } from "./schema.js";
import {
  add,
  checkSnapshot,
  payoutClaimFingerprint,
  sourceById,
} from "../payoutRelease/helpers.js";
import { readFees } from "../payoutRelease/fees.js";
/** Package-authenticated provider proof, rechecked against all local financial state under OCC. */
export async function validateAdoption(
  ctx: MutationCtx,
  scope: { accountId: string; ownerKey: string },
  proof: Infer<typeof adoptionProof>,
) {
  await checkSnapshot(ctx, scope.accountId, proof.observations, true);
  const rows = await ctx.db
    .query("payoutReleaseClaims")
    .withIndex("by_account_status", (q) => q.eq("accountId", scope.accountId))
    .take(101);
  const expected = new Map(
    proof.claims.map((c) => [c.operationKey, c.fingerprint]),
  );
  if (
    rows.length > 100 ||
    expected.size !== proof.claims.length ||
    rows.length !== expected.size ||
    rows.some(
      (c) =>
        c.ownerKey !== scope.ownerKey ||
        c.status === "reserved" ||
        c.status === "submitted" ||
        expected.get(c.operationKey) !== payoutClaimFingerprint(c),
    )
  )
    throw new Error(
      "Adoption payout history snapshot changed or is unresolved.",
    );
  const owed = new Map<string, number>();
  for (const o of proof.observations) {
    const source = await sourceById(ctx, o.stripeTransferId);
    if (
      source &&
      (source.accountId !== scope.accountId ||
        source.ownerKey !== scope.ownerKey ||
        source.currency !== o.currency ||
        source.reservedAmount !== 0)
    )
      throw new Error(
        "Adoption source allocation identity or reservations changed.",
      );
    owed.set(
      o.currency,
      add(
        owed.get(o.currency) ?? 0,
        add(add(o.matureNet, o.pendingCredits), -(source?.paidAmount ?? 0)),
      ),
    );
  }
  let hasHeld = false;
  for (const [currency, amount] of owed) {
    const fees = await readFees(ctx, { ...scope, currency });
    if (add(amount, -(fees?.amount ?? 0)) > 0) hasHeld = true;
  }
  if (
    proof.oldestHeldAt !== undefined &&
    (!Number.isSafeInteger(proof.oldestHeldAt) ||
      proof.oldestHeldAt < 0 ||
      proof.oldestHeldAt > Date.now())
  )
    throw new Error("Invalid adoption holding timestamp.");
  if (hasHeld && proof.oldestHeldAt === undefined)
    throw new Error("Adoption holding age is required for unpaid funds.");
  return proof.oldestHeldAt ?? Date.now();
}
