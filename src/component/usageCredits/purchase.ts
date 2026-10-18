import { convexToJson } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import {
  purchaseTerms,
  account,
  activeEnrollment,
  grants,
  history,
  purchase,
} from "./helpers.js";
import {
  paymentCreditProof,
  grantCreditProof,
} from "../../client/usage/creditProofs.js";
import { closureByStripeId } from "../accountClosure/helpers.js";
export async function preparePurchase(ctx: MutationCtx, inputJson: string) {
  const parsed = await purchaseTerms(inputJson),
    { terms } = parsed;
  const prior = await ctx.db
    .query("usageCreditPurchases")
    .withIndex("by_key", (q) => q.eq("key", parsed.key))
    .unique();
  if (prior) {
    if (prior.termsJson !== parsed.termsJson)
      throw new Error("Credit purchase replay conflict");
    return prior;
  }
  for (const id of [terms.scope.stripeAccountId, terms.scope.customerAccount])
    if (await closureByStripeId(ctx, id))
      throw new Error("Account closure prevents credit purchase");
  const { item } = await activeEnrollment(ctx, parsed.account.binding);
  if (
    terms.expiresAt !== undefined &&
    terms.expiresAt <= item.period.end + 72 * 3600
  )
    throw new Error(
      "Credit expiry must cover original billing closeout and finalization",
    );
  let ledger = await ctx.db
    .query("usageCreditAccounts")
    .withIndex("by_key", (q) => q.eq("key", parsed.account.key))
    .unique();
  if (!ledger) {
    const id = await ctx.db.insert("usageCreditAccounts", {
      key: parsed.account.key,
      scopeKey: parsed.account.scopeKey,
      bindingJson: parsed.account.bindingJson,
      stripeAccountId: terms.scope.stripeAccountId,
      customerAccount: terms.scope.customerAccount,
      closed: false,
      purchaseCount: 0,
      historyCount: 0,
    });
    ledger = (await ctx.db.get("usageCreditAccounts", id))!;
  }
  if (ledger.closed || ledger.frozenReason)
    throw new Error("Credit account requires reconciliation");
  if (ledger.purchaseCount >= 1000)
    throw new Error("Credit account retained purchase quota exhausted");
  const rows = await grants(ctx, ledger.key);
  if (
    rows.filter(
      (g) =>
        !g.frozen &&
        BigInt(g.available) + BigInt(g.reserved) > 0n &&
        (g.expiresAt === null || g.expiresAt > Date.now() / 1000),
    ).length >= 100
  )
    throw new Error("Credit account active grant quota exhausted");
  const id = await ctx.db.insert("usageCreditPurchases", {
    key: parsed.key,
    accountKey: ledger.key,
    termsJson: parsed.termsJson,
    firstAttemptAt: Math.floor(Date.now() / 1000),
    state: "pending",
  });
  await ctx.db.patch("usageCreditAccounts", ledger._id, {
    purchaseCount: ledger.purchaseCount + 1,
  });
  await history(ctx, ledger.key, "purchase", parsed.key, { terms }, parsed.key);
  return (await ctx.db.get("usageCreditPurchases", id))!;
}
export async function pinPayment(
  ctx: MutationCtx,
  key: string,
  paymentIntentId: string,
) {
  if (!/^pi_[a-zA-Z0-9_]{1,190}$/.test(paymentIntentId))
    throw new Error("Invalid credit payment identity");
  const row = await purchase(ctx, key),
    { terms } = await purchaseTerms(row.termsJson);
  if (row.paymentIntentId && row.paymentIntentId !== paymentIntentId)
    throw new Error("Credit payment identity conflict");
  const paymentKey = JSON.stringify([
    terms.scope.stripeAccountId,
    terms.scope.livemode,
    paymentIntentId,
  ]);
  const other = await ctx.db
    .query("usageCreditPurchases")
    .withIndex("by_payment", (q) => q.eq("paymentKey", paymentKey))
    .unique();
  if (other && other.key !== key)
    throw new Error("Credit payment already backs another purchase");
  await ctx.db.patch("usageCreditPurchases", row._id, {
    paymentIntentId,
    paymentKey,
  });
}
export async function verifyPayment(
  ctx: MutationCtx,
  key: string,
  proofJson: string,
) {
  const proof = paymentCreditProof.parse(JSON.parse(proofJson)),
    row = await purchase(ctx, key);
  const { terms } = await purchaseTerms(row.termsJson);
  if (
    row.paymentIntentId !== proof.paymentIntentId ||
    proof.amount !== terms.amount ||
    proof.currency !== terms.binding.plan.rate.currency ||
    proof.customerAccount !== terms.scope.customerAccount ||
    proof.livemode !== terms.scope.livemode
  )
    throw new Error("Credit payment provenance mismatch");
  const normalized = JSON.stringify(convexToJson(proof));
  if (row.paymentProofJson && row.paymentProofJson !== normalized)
    throw new Error("Credit payment proof conflict");
  if (row.state === "frozen" || row.state === "canceled")
    throw new Error("Credit payment requires recovery");
  await ctx.db.patch("usageCreditPurchases", row._id, {
    paymentProofJson: normalized,
    grantFirstAttemptAt:
      row.grantFirstAttemptAt ?? Math.floor(Date.now() / 1000),
  });
  await history(
    ctx,
    row.accountKey,
    "payment",
    proof.paymentIntentId,
    proof,
    key,
  );
}
export async function pinGrant(
  ctx: MutationCtx,
  key: string,
  proofJson: string,
) {
  const proof = grantCreditProof.parse(JSON.parse(proofJson)),
    row = await purchase(ctx, key);
  const { terms } = await purchaseTerms(row.termsJson);
  if (!row.paymentProofJson || row.state === "frozen")
    throw new Error("Verified credit payment required");
  const original = JSON.parse(row.paymentProofJson) as ReturnType<
    typeof paymentCreditProof.parse
  >;
  if (
    Object.entries(original).some(
      ([field, value]) => proof[field as keyof typeof proof] !== value,
    ) ||
    proof.stripePriceId !== terms.binding.stripePriceId ||
    proof.expiresAt !== (terms.expiresAt ?? null) ||
    proof.effectiveAt > Date.now() / 1000 + 300
  )
    throw new Error("Credit grant provenance mismatch");
  if (row.creditGrantId && row.creditGrantId !== proof.creditGrantId)
    throw new Error("Credit grant identity conflict");
  const other = await ctx.db
    .query("usageCreditGrants")
    .withIndex("by_native", (q) => q.eq("creditGrantId", proof.creditGrantId))
    .unique();
  if (other) {
    if (
      other.purchaseKey !== key ||
      other.proofJson !== JSON.stringify(convexToJson(proof))
    )
      throw new Error("Credit grant replay conflict");
    return;
  }
  const ledger = await account(ctx, row.accountKey);
  if (ledger.closed || ledger.frozenReason)
    throw new Error("Credit account requires reconciliation");
  await ctx.db.insert("usageCreditGrants", {
    purchaseKey: key,
    accountKey: row.accountKey,
    creditGrantId: proof.creditGrantId,
    paymentIntentId: proof.paymentIntentId,
    chargeId: proof.chargeId,
    proofJson: JSON.stringify(convexToJson(proof)),
    available: terms.scaledQuantity,
    reserved: "0",
    consumed: "0",
    effectiveAt: proof.effectiveAt,
    expiresAt: proof.expiresAt,
    frozen: false,
  });
  await ctx.db.patch("usageCreditPurchases", row._id, {
    state: "ready",
    creditGrantId: proof.creditGrantId,
  });
  await history(ctx, row.accountKey, "grant", proof.creditGrantId, proof, key);
}
