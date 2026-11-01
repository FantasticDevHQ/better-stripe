import type { QueryCtx } from "../_generated/server";
import { historyActor } from "../billing/history/actor";
import type { Infer } from "convex/values";
import type { witnessIdentity, witnessScope } from "./validators";

export function validText(value: string, max = 255) {
  return value.length > 0 && value.length <= max && value.trim() === value;
}
export function validPermission(
  permission: null | {
    authorizationId: string;
    authorizationRevision: number;
    expiresAtMs: number;
    revoked: boolean;
  },
) {
  return (
    permission !== null &&
    !permission.revoked &&
    validText(permission.authorizationId) &&
    Number.isSafeInteger(permission.authorizationRevision) &&
    permission.authorizationRevision > 0 &&
    Number.isSafeInteger(permission.expiresAtMs) &&
    permission.expiresAtMs > Date.now()
  );
}
export async function operationGrant(
  ctx: QueryCtx,
  args: {
    componentScope: string;
    parentOperationId: string;
    operationId: string;
  },
) {
  const user = await historyActor(ctx);
  if (
    ![args.componentScope, args.parentOperationId, args.operationId].every(
      (value) => validText(value),
    )
  )
    return null;
  const rows = await ctx.db
    .query("renewalOperationGrants")
    .withIndex("by_user_and_operation", (q) =>
      q
        .eq("userId", user._id)
        .eq("componentScope", args.componentScope)
        .eq("parentOperationId", args.parentOperationId)
        .eq("operationId", args.operationId),
    )
    .take(2);
  // Count contradictions before inspecting expiry or revocation.
  if (rows.length !== 1) return null;
  const grant = rows[0];
  if (
    grant.tokenIdentifier !== user.authTokenIdentifier ||
    !validText(grant.tokenIdentifier, 2048) ||
    ![
      grant.providerScope.customerAccountId,
      grant.providerScope.customerId,
      grant.providerScope.subscriptionId,
      grant.providerScope.scheduleId,
    ].every((value) => validText(value))
  )
    return null;
  return grant;
}

export function sameProvider(
  a: {
    mode: "platform";
    stripeAccount: null;
    livemode: boolean;
    customerAccountId: string;
    customerId: string;
    subscriptionId: string;
    scheduleId: string;
  },
  b: typeof a,
) {
  return (
    a.mode === b.mode &&
    a.stripeAccount === b.stripeAccount &&
    a.livemode === b.livemode &&
    a.customerAccountId === b.customerAccountId &&
    a.customerId === b.customerId &&
    a.subscriptionId === b.subscriptionId &&
    a.scheduleId === b.scheduleId
  );
}

type Identity = Infer<typeof witnessIdentity>;
type Scope = Infer<typeof witnessScope>;
export function sameIdentity(a: Identity, b: Identity) {
  return (
    a.componentScope === b.componentScope &&
    a.parentOperationId === b.parentOperationId &&
    a.operationId === b.operationId &&
    a.witnessId === b.witnessId
  );
}
export function sameWitnessScope(a: Scope, b: Scope) {
  return (
    sameIdentity(a.identity, b.identity) &&
    sameProvider(a.providerScope, b.providerScope) &&
    a.configureRequestBinding === b.configureRequestBinding &&
    a.observedItemId === b.observedItemId &&
    a.nativePeriod.start === b.nativePeriod.start &&
    a.nativePeriod.end === b.nativePeriod.end
  );
}
export async function witnessGrant(ctx: QueryCtx, identity: Identity) {
  const user = await historyActor(ctx);
  if (!Object.values(identity).every((value) => validText(value))) return null;
  const rows = await ctx.db
    .query("renewalWitnessGrants")
    .withIndex("by_user_and_witness", (q) =>
      q
        .eq("userId", user._id)
        .eq("componentScope", identity.componentScope)
        .eq("witnessId", identity.witnessId),
    )
    .take(2);
  if (rows.length !== 1) return null;
  const grant = rows[0];
  const scope = grant.scope;
  const period = scope.nativePeriod;
  if (
    grant.tokenIdentifier !== user.authTokenIdentifier ||
    !validText(grant.tokenIdentifier, 2048) ||
    !sameIdentity(scope.identity, identity) ||
    ![
      scope.configureRequestBinding,
      scope.observedItemId,
      scope.providerScope.customerAccountId,
      scope.providerScope.customerId,
      scope.providerScope.subscriptionId,
      scope.providerScope.scheduleId,
    ].every((value) => validText(value)) ||
    !Number.isSafeInteger(period.start) ||
    !Number.isSafeInteger(period.end) ||
    period.start < 0 ||
    period.end <= period.start
  )
    return null;
  return grant;
}
