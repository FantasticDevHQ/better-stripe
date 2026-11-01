import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import {
  operationFields,
  observationSnapshot,
  invoiceFields,
  invoiceSnapshot,
  retainFields,
  readFields,
  retainSnapshot,
  readSnapshot,
} from "./validators";
import {
  operationGrant,
  sameProvider,
  validPermission,
  validText,
  witnessGrant,
  sameWitnessScope,
} from "./authorization";

export const observe = internalQuery({
  args: operationFields,
  returns: v.union(v.null(), observationSnapshot),
  handler: async (ctx, args) => {
    const grant = await operationGrant(ctx, args);
    if (!grant || !validPermission(grant.observation) || !grant.observation)
      return null;
    const scope = grant.providerScope;
    return {
      ...args,
      tokenIdentifier: grant.tokenIdentifier,
      providerScope: {
        mode: scope.mode,
        stripeAccount: scope.stripeAccount,
        livemode: scope.livemode,
        customerAccountId: scope.customerAccountId,
        subscriptionId: scope.subscriptionId,
        scheduleId: scope.scheduleId,
      },
      authorizationId: grant.observation.authorizationId,
      authorizationRevision: grant.observation.authorizationRevision,
      expiresAtMs: grant.observation.expiresAtMs,
    };
  },
});

export const invoices = internalQuery({
  args: invoiceFields,
  returns: v.union(v.null(), invoiceSnapshot),
  handler: async (ctx, args) => {
    const grant = await operationGrant(ctx, args);
    if (!grant || !grant.invoice || !validPermission(grant.invoice))
      return null;
    const permission = grant.invoice;
    if (
      !sameProvider(args.providerScope, grant.providerScope) ||
      !validText(permission.originalInvoiceId) ||
      !validText(permission.currentInvoiceId) ||
      args.originalInvoiceId !== permission.originalInvoiceId ||
      args.currentInvoiceId !== permission.currentInvoiceId
    )
      return null;
    return {
      ...args,
      tokenIdentifier: grant.tokenIdentifier,
      authorizationId: permission.authorizationId,
      authorizationRevision: permission.authorizationRevision,
      expiresAtMs: permission.expiresAtMs,
    };
  },
});

export const retainWitness = internalQuery({
  args: retainFields,
  returns: v.union(v.null(), retainSnapshot),
  handler: async (ctx, args) => {
    const grant = await witnessGrant(ctx, args.scope.identity);
    if (
      !grant ||
      !grant.retain ||
      !validPermission(grant.retain) ||
      !sameWitnessScope(grant.scope, args.scope)
    )
      return null;
    return {
      capability: args.capability,
      scope: grant.scope,
      tokenIdentifier: grant.tokenIdentifier,
      authorizationId: grant.retain.authorizationId,
      authorizationRevision: grant.retain.authorizationRevision,
      expiresAtMs: grant.retain.expiresAtMs,
    };
  },
});

export const readWitness = internalQuery({
  args: readFields,
  returns: v.union(v.null(), readSnapshot),
  handler: async (ctx, args) => {
    const grant = await witnessGrant(ctx, args.identity);
    if (!grant || !grant.read || !validPermission(grant.read)) return null;
    const permission = grant.read;
    if (
      !validText(permission.witnessRowId) ||
      !/^renewal-witness:v1:sha256:[0-9a-f]{64}$/.test(
        permission.payloadBinding,
      )
    )
      return null;
    return {
      capability: args.capability,
      scope: grant.scope,
      tokenIdentifier: grant.tokenIdentifier,
      authorizationId: permission.authorizationId,
      authorizationRevision: permission.authorizationRevision,
      expiresAtMs: permission.expiresAtMs,
      witnessRowId: permission.witnessRowId,
      payloadBinding: permission.payloadBinding,
    };
  },
});
