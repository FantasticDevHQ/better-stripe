import { convexToJson, type Value } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import {
  creditBinding,
  creditPurchaseTerms,
  type UsageCreditBinding,
} from "../../client/usage/creditTerms.js";
import { scopeKey } from "../usage/helpers.js";
import { jsonTerms } from "../usageSubscriptions/helpers.js";
import type { UsageSubscriptionView } from "../../client/usage/subscriptionTerms.js";
export function boundedJson(json: string, max = 8192) {
  if (new TextEncoder().encode(json).length > max)
    throw new Error("Credit payload exceeds size limit");
  return JSON.parse(json) as unknown;
}
export async function accountTerms(input: UsageCreditBinding) {
  const binding = creditBinding(input),
    bindingJson = JSON.stringify(convexToJson(binding));
  return {
    binding,
    bindingJson,
    key: await canonicalFingerprint(binding),
    scopeKey: scopeKey(binding.scope),
  };
}
export async function purchaseTerms(json: string) {
  const terms = creditPurchaseTerms(boundedJson(json));
  const account = await accountTerms(terms);
  const termsJson = JSON.stringify(
    convexToJson({
      scope: terms.scope,
      binding: terms.binding,
      purchaseId: terms.purchaseId,
      quantity: terms.quantity,
      ownership: terms.ownership,
      rollover: terms.rollover,
      ...(terms.expiresAt === undefined ? {} : { expiresAt: terms.expiresAt }),
    }),
  );
  return {
    terms,
    termsJson,
    account,
    key: await canonicalFingerprint([account.key, terms.purchaseId]),
  };
}
export async function purchase(ctx: QueryCtx, key: string) {
  const row = await ctx.db
    .query("usageCreditPurchases")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) throw new Error("Credit purchase unavailable");
  return row;
}
export async function account(ctx: QueryCtx, key: string) {
  const row = await ctx.db
    .query("usageCreditAccounts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) throw new Error("Credit account unavailable");
  return row;
}
export async function grants(ctx: QueryCtx, key: string) {
  const rows = await ctx.db
    .query("usageCreditGrants")
    .withIndex("by_account", (q) => q.eq("accountKey", key))
    .take(1001);
  if (rows.length > 1000)
    throw new Error("Credit account retained grant quota exceeded");
  return rows;
}
export async function activeEnrollment(
  ctx: QueryCtx,
  binding: ReturnType<typeof creditBinding>,
) {
  const { scope } = binding;
  const lock = await ctx.db
    .query("usageSubscriptionLocks")
    .withIndex("by_key", (q) =>
      q.eq(
        "key",
        JSON.stringify([
          scope.stripeAccountId,
          scope.livemode,
          binding.binding.stripeCustomerId,
          scope.meterId,
        ]),
      ),
    )
    .unique();
  const intent =
    lock &&
    (await ctx.db
      .query("usageSubscriptionIntents")
      .withIndex("by_key", (q) => q.eq("key", lock.intentKey))
      .unique());
  if (!intent?.viewJson || intent.retiredAt !== undefined)
    throw new Error("Active managed prepaid enrollment required");
  const terms = jsonTerms(intent.termsJson).terms;
  const match = terms.meters.find((m) => m.scope.meterId === scope.meterId);
  if (
    !match ||
    JSON.stringify(convexToJson(match)) !==
      JSON.stringify(convexToJson(binding))
  )
    throw new Error("Original prepaid enrollment terms mismatch");
  const view = JSON.parse(intent.viewJson) as UsageSubscriptionView;
  if (view.status !== "active" || view.collection.method !== "send_invoice")
    throw new Error(
      "Prepaid accounting requires active managed send-invoice collection",
    );
  const item = view.items.find(
    (i) => i.stripePriceId === binding.binding.stripePriceId,
  );
  if (!item || Date.now() / 1000 >= item.period.end - 60)
    throw new Error("Prepaid billing period is closing");
  return { intent, view, item };
}
export async function history(
  ctx: MutationCtx,
  accountKey: string,
  kind: Doc<"usageCreditHistory">["kind"],
  sourceKey: string,
  evidence: Value,
  purchaseKey?: string,
) {
  const evidenceJson = JSON.stringify(convexToJson(evidence));
  if (evidenceJson.length > 8192)
    throw new Error("Credit history evidence exceeds size limit");
  const fingerprint = await canonicalFingerprint([
    accountKey,
    kind,
    sourceKey,
    evidence,
  ]);
  if (
    await ctx.db
      .query("usageCreditHistory")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .unique()
  )
    return;
  const row = await account(ctx, accountKey);
  if (row.historyCount >= 100000)
    throw new Error("Credit history retained quota exhausted");
  await ctx.db.insert("usageCreditHistory", {
    accountKey,
    purchaseKey,
    kind,
    sourceKey,
    fingerprint,
    evidenceJson,
    at: Math.floor(Date.now() / 1000),
  });
  await ctx.db.patch("usageCreditAccounts", row._id, {
    historyCount: row.historyCount + 1,
  });
}
