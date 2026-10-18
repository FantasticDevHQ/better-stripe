import type { Value } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import {
  prepareUsageRecord,
  type PreparedUsageRecord,
  type UsageScope,
} from "../../client/usage/records.js";
import {
  allowanceStatus,
  limitPolicy,
} from "../../client/usage/allowanceTerms.js";
import { parseUsageQuantity } from "../../client/usage/contracts.js";
import { subscriptionSnapshot, scopeKey } from "../usage/helpers.js";
import {
  terms,
  json,
  canonical,
  policyRow,
  active,
  history,
  overlapping,
  scopeOverlap,
  configuredScope,
} from "./helpers.js";
export async function reserve(
  ctx: MutationCtx,
  inputJson: string,
  subscriptionJson: string,
) {
  const event = prepareUsageRecord(json(inputJson)),
    subscription = subscriptionSnapshot(subscriptionJson),
    original = terms({
      scope: event.scope,
      binding: event.binding,
      subscription,
    });
  const input = canonical(event),
    sub = canonical(subscription);
  const prior = await ctx.db
    .query("usageReservations")
    .withIndex("by_scope_source", (q) =>
      q
        .eq("scopeKey", original.scopeKey)
        .eq("sourceEventId", event.sourceEventId),
    )
    .unique();
  if (prior) {
    if (
      prior.accountingKind !== "allowance" ||
      prior.inputJson !== input ||
      prior.subscriptionJson !== sub
    )
      throw new Error("Allowance reservation replay conflict");
    return {
      reservationId: prior._id,
      state: prior.state,
      revision: Number(prior.allocationsJson),
    };
  }
  const accepted = await ctx.db
    .query("usageEvents")
    .withIndex("by_identity", (q) => q.eq("identity", event.identity))
    .unique();
  if (accepted) throw new Error("Accepted usage cannot be reserved again");
  const row = await policyRow(ctx, original.key);
  if (!row || row.bindingJson !== original.bindingJson)
    throw new Error("Allowance policy unavailable");
  await active(ctx, original.binding, event);
  const policy = limitPolicy(JSON.parse(row.policyJson), original.binding),
    status = allowanceStatus(
      original.binding,
      policy,
      row,
      Math.floor(Date.now() / 1000),
    );
  if (!policy.entitled)
    return {
      state: "denied" as const,
      reason: "not_entitled" as const,
      revision: row.revision,
    };
  if (
    status.hardLimitRemainingQuantity !== null &&
    BigInt(event.scaledQuantity) >
      BigInt(
        parseUsageQuantity(
          status.hardLimitRemainingQuantity,
          event.binding.plan.unit.precision,
        ).scaledQuantity,
      )
  )
    return {
      state: "denied" as const,
      reason: "hard_limit" as const,
      revision: row.revision,
    };
  const reserved = BigInt(row.reserved) + BigInt(event.scaledQuantity);
  if (reserved + BigInt(row.consumed) > 999999999999999999n)
    throw new Error("Allowance accounting quantity bound exceeded");
  const reservationId = await ctx.db.insert("usageReservations", {
    scopeKey: original.scopeKey,
    sourceEventId: event.sourceEventId,
    planJson: JSON.stringify(event.binding.plan),
    scaledQuantity: event.scaledQuantity,
    state: "reserved",
    accountingKind: "allowance",
    accountKey: row.key,
    inputJson: input,
    subscriptionJson: sub,
    allocationsJson: String(row.revision),
  });
  await ctx.db.patch("usageAllowancePolicies", row._id, {
    reserved: reserved.toString(),
  });
  await history(ctx, row, "reservation", {
    reservationId,
    event,
    subscription,
    revision: row.revision,
  });
  return { reservationId, state: "reserved" as const, revision: row.revision };
}
export async function requireReservation(
  ctx: MutationCtx,
  event: PreparedUsageRecord,
  subscription: ReturnType<typeof subscriptionSnapshot>,
  reservation: Doc<"usageReservations"> | null,
) {
  if (event.binding.plan.model === "prepaid") return;
  const original = terms({
    scope: event.scope,
    binding: event.binding,
    subscription,
  });
  const row =
    (await overlapping(ctx, original.nativeKey, subscription.period)) ??
    (await scopeOverlap(ctx, original.scopeKey, subscription.period));
  if (!row && (await configuredScope(ctx, original)))
    throw new Error(
      "New allowance period requires policy configuration and reservation",
    );
  if (
    row &&
    (row.bindingJson !== original.bindingJson ||
      !reservation ||
      reservation.accountingKind !== "allowance" ||
      reservation.accountKey !== row.key)
  )
    throw new Error("Matching allowance reservation required");
}
export async function commit(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  event: Value,
  subscription: Value,
  eventId: Id<"usageEvents">,
) {
  if (
    reservation.accountingKind !== "allowance" ||
    !reservation.accountKey ||
    reservation.inputJson !== canonical(event) ||
    reservation.subscriptionJson !== canonical(subscription)
  )
    throw new Error("Allowance reservation provenance mismatch");
  const row = await policyRow(ctx, reservation.accountKey);
  if (!row || BigInt(row.reserved) < BigInt(reservation.scaledQuantity))
    throw new Error("Allowance reservation backing unavailable");
  await ctx.db.patch("usageAllowancePolicies", row._id, {
    reserved: (
      BigInt(row.reserved) - BigInt(reservation.scaledQuantity)
    ).toString(),
    consumed: (
      BigInt(row.consumed) + BigInt(reservation.scaledQuantity)
    ).toString(),
  });
  await history(ctx, row, "commit", {
    reservationId: reservation._id,
    eventId,
    revision: Number(reservation.allocationsJson),
    scaledQuantity: reservation.scaledQuantity,
  });
}
export async function release(
  ctx: MutationCtx,
  scope: UsageScope,
  reservationId: Id<"usageReservations">,
  reason: string,
) {
  const row = await ctx.db.get("usageReservations", reservationId);
  if (
    !row ||
    row.scopeKey !== scopeKey(scope) ||
    row.accountingKind !== "allowance" ||
    !row.accountKey
  )
    throw new Error("Allowance reservation unavailable");
  if (row.state === "committed" || row.eventId)
    throw new Error("Committed usage requires an auditable correction");
  if (row.state === "released") {
    if (row.releaseReason !== reason)
      throw new Error("Allowance release replay conflict");
    return;
  }
  const policy = await policyRow(ctx, row.accountKey);
  if (!policy || BigInt(policy.reserved) < BigInt(row.scaledQuantity))
    throw new Error("Allowance reservation invariant violated");
  await ctx.db.patch("usageAllowancePolicies", policy._id, {
    reserved: (BigInt(policy.reserved) - BigInt(row.scaledQuantity)).toString(),
  });
  await ctx.db.patch("usageReservations", row._id, {
    state: "released",
    releaseReason: reason,
  });
  await history(ctx, policy, "release", {
    reservationId,
    reason,
    scaledQuantity: row.scaledQuantity,
  });
}
