import { z } from "zod";
import { convexToJson, type Value } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import { prepareUsageRecord } from "../../client/usage/records.js";
import { creditCost } from "../../client/usage/creditTerms.js";
import { scopeKey, subscriptionSnapshot } from "../usage/helpers.js";
import {
  accountTerms,
  account,
  grants,
  activeEnrollment,
  history,
  boundedJson,
} from "./helpers.js";
export const creditAllocations = z
  .array(
    z.strictObject({
      grantId: z.string().min(1).max(100),
      quantity: z.string().regex(/^[1-9]\d{0,17}$/),
    }),
  )
  .min(1)
  .max(10);
const canonical = (value: Value) => JSON.stringify(convexToJson(value));
export async function reserve(
  ctx: MutationCtx,
  inputJson: string,
  subscriptionJson: string,
) {
  const event = prepareUsageRecord(boundedJson(inputJson));
  const subscription = subscriptionSnapshot(subscriptionJson);
  const original = await accountTerms(event),
    key = original.scopeKey;
  creditCost(event.binding.plan, event.scaledQuantity);
  const input = canonical(event),
    sub = canonical(subscription);
  const prior = await ctx.db
    .query("usageReservations")
    .withIndex("by_scope_source", (q) =>
      q.eq("scopeKey", key).eq("sourceEventId", event.sourceEventId),
    )
    .unique();
  if (prior) {
    if (
      prior.accountingKind !== "prepaid" ||
      prior.inputJson !== input ||
      prior.subscriptionJson !== sub
    )
      throw new Error("Credit reservation replay conflict");
    return { reservationId: prior._id, state: prior.state };
  }
  const ledger = await account(ctx, original.key);
  if (ledger.closed || ledger.frozenReason)
    throw new Error("Credit account requires reconciliation");
  const { view, item } = await activeEnrollment(ctx, original.binding);
  const now = Math.floor(Date.now() / 1000);
  if (
    subscription.subscriptionId !== view.subscriptionId ||
    subscription.subscriptionItemId !== item.id ||
    subscription.stripePriceId !== item.stripePriceId ||
    subscription.period.start !== item.period.start ||
    subscription.period.end !== item.period.end ||
    event.occurredAt < subscription.period.start ||
    event.occurredAt >= subscription.period.end ||
    event.occurredAt < now - 35 * 86400 ||
    event.occurredAt > now + 300
  )
    throw new Error("Credit reservation subscription period mismatch");
  const rows = (await grants(ctx, ledger.key)).filter(
    (g) =>
      !g.frozen &&
      g.effectiveAt <= now &&
      (g.expiresAt === null ||
        g.expiresAt > subscription.period.end + 72 * 3600),
  );
  rows.sort(
    (a, b) =>
      (a.expiresAt ?? Number.MAX_SAFE_INTEGER) -
        (b.expiresAt ?? Number.MAX_SAFE_INTEGER) ||
      a.effectiveAt - b.effectiveAt ||
      a.nativeCreated - b.nativeCreated ||
      a.creditGrantId.localeCompare(b.creditGrantId),
  );
  let remaining = BigInt(event.scaledQuantity);
  const selected: z.infer<typeof creditAllocations> = [];
  for (const grant of rows) {
    const quantity =
      BigInt(grant.available) < remaining ? BigInt(grant.available) : remaining;
    if (quantity === 0n) continue;
    if (selected.length === 10) break;
    creditCost(event.binding.plan, quantity.toString());
    selected.push({ grantId: grant._id, quantity: quantity.toString() });
    await ctx.db.patch("usageCreditGrants", grant._id, {
      available: (BigInt(grant.available) - quantity).toString(),
      reserved: (BigInt(grant.reserved) + quantity).toString(),
    });
    remaining -= quantity;
    if (remaining === 0n) break;
  }
  if (remaining > 0n)
    throw new Error("Insufficient prepaid credits within bounded allocation");
  const id = await ctx.db.insert("usageReservations", {
    scopeKey: key,
    sourceEventId: event.sourceEventId,
    planJson: JSON.stringify(event.binding.plan),
    scaledQuantity: event.scaledQuantity,
    state: "reserved",
    accountingKind: "prepaid",
    accountKey: ledger.key,
    inputJson: input,
    subscriptionJson: sub,
    allocationsJson: JSON.stringify(selected),
  });
  await history(ctx, ledger.key, "reservation", id, {
    input: event,
    subscription,
    allocations: selected,
  });
  return { reservationId: id, state: "reserved" as const };
}
export async function commit(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  input: Value,
  subscription: Value,
  eventId: Id<"usageEvents">,
) {
  if (
    reservation.accountingKind !== "prepaid" ||
    !reservation.accountKey ||
    reservation.inputJson !== canonical(input) ||
    reservation.subscriptionJson !== canonical(subscription)
  )
    throw new Error("Prepaid reservation provenance mismatch");
  const ledger = await account(ctx, reservation.accountKey);
  if (ledger.closed || ledger.frozenReason)
    throw new Error("Credit account requires reconciliation");
  const selected = creditAllocations.parse(
    JSON.parse(reservation.allocationsJson!),
  );
  for (const item of selected) {
    const grant = await ctx.db.get(
      "usageCreditGrants",
      item.grantId as Id<"usageCreditGrants">,
    );
    if (
      !grant ||
      grant.accountKey !== ledger.key ||
      grant.frozen ||
      BigInt(grant.reserved) < BigInt(item.quantity)
    )
      throw new Error("Credit reservation backing unavailable");
    await ctx.db.patch("usageCreditGrants", grant._id, {
      reserved: (BigInt(grant.reserved) - BigInt(item.quantity)).toString(),
      consumed: (BigInt(grant.consumed) + BigInt(item.quantity)).toString(),
    });
  }
  await history(ctx, ledger.key, "commit", reservation._id, {
    eventId,
    sourceEventId: reservation.sourceEventId,
    allocations: selected,
    cashCollection: "none",
  });
}
export async function release(
  ctx: MutationCtx,
  scope: Parameters<typeof scopeKey>[0],
  reservationId: Id<"usageReservations">,
  reason: string,
) {
  if (!["work_failed", "abandoned_before_work"].includes(reason))
    throw new Error("Explicit uncommitted work recovery reason required");
  const row = await ctx.db.get("usageReservations", reservationId);
  if (
    !row ||
    row.scopeKey !== scopeKey(scope) ||
    row.accountingKind !== "prepaid" ||
    !row.accountKey
  )
    throw new Error("Credit reservation unavailable");
  if (row.state === "committed" || row.eventId)
    throw new Error("Committed usage requires an auditable correction");
  if (row.state === "released") {
    if (row.releaseReason !== reason)
      throw new Error("Credit release replay conflict");
    return;
  }
  const selected = creditAllocations.parse(JSON.parse(row.allocationsJson!));
  for (const item of selected) {
    const grant = await ctx.db.get(
      "usageCreditGrants",
      item.grantId as Id<"usageCreditGrants">,
    );
    if (
      !grant ||
      grant.accountKey !== row.accountKey ||
      BigInt(grant.reserved) < BigInt(item.quantity)
    )
      throw new Error("Credit reservation invariant violated");
    await ctx.db.patch("usageCreditGrants", grant._id, {
      reserved: (BigInt(grant.reserved) - BigInt(item.quantity)).toString(),
      available: (BigInt(grant.available) + BigInt(item.quantity)).toString(),
    });
  }
  await ctx.db.patch("usageReservations", row._id, {
    state: "released",
    releaseReason: reason,
  });
  await history(ctx, row.accountKey, "release", row._id, {
    reason,
    allocations: selected,
  });
}
