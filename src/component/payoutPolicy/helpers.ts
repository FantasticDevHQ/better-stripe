import type { Infer } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import type { schedule, thresholds } from "./schema.js";
export function canonicalSchedule(value: Infer<typeof schedule>) {
  const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  if (value.interval === "weekly") {
    const days = value.weeklyDays;
    if (
      !days?.length ||
      days.length > 7 ||
      new Set(days).size !== days.length ||
      days.some((day) => !weekdays.includes(day))
    )
      throw new Error("Invalid weekly payout schedule.");
    return { interval: value.interval, weeklyDays: [...days].sort() };
  }
  if (value.interval === "monthly") {
    const days = value.monthlyDays;
    if (
      !days?.length ||
      days.length > 31 ||
      new Set(days).size !== days.length ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 31)
    )
      throw new Error("Invalid monthly payout schedule.");
    return {
      interval: value.interval,
      monthlyDays: [...days].sort((a, b) => a - b),
    };
  }
  return { interval: value.interval };
}
export function canonicalThresholds(
  values: Infer<typeof thresholds>,
  custom: boolean,
) {
  if (
    (custom && !values.length) ||
    values.length > 50 ||
    (!custom && values.length) ||
    new Set(values.map((v) => v.currency)).size !== values.length ||
    values.some(
      (v) =>
        !Number.isSafeInteger(v.amount) ||
        v.amount <= 0 ||
        !/^[a-z]{3}$/.test(v.currency),
    )
  )
    throw new Error("Invalid custom payout thresholds.");
  return [...values].sort((a, b) => a.currency.localeCompare(b.currency));
}
export function validateScope(scope: { accountId: string; ownerKey: string }) {
  if (
    !/^acct_\w+$/.test(scope.accountId) ||
    scope.accountId.length > 80 ||
    !scope.ownerKey.trim() ||
    scope.ownerKey.length > 200
  )
    throw new Error("Invalid payout policy identity.");
}
export async function readPolicy(
  ctx: QueryCtx | MutationCtx,
  scope: { accountId: string; ownerKey: string },
) {
  validateScope(scope);
  const value = await ctx.db
    .query("payoutPolicies")
    .withIndex("by_account", (q) => q.eq("accountId", scope.accountId))
    .unique();
  if (value && value.ownerKey !== scope.ownerKey)
    throw new Error("Payout policy owner does not match.");
  return value;
}
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function holdingDays(country: string) {
  if (!/^[A-Z]{2}$/.test(country))
    throw new Error("A verified account country is required.");
  return country === "TH" ? 10 : country === "US" ? 730 : 90;
}
