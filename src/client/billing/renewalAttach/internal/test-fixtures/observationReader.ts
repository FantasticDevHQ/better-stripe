import { makeFunctionReference, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { vi } from "vitest";
import { historySnapshot } from "./historySnapshot.js";
import { admissionControls } from "./producerConfigureAdmission.js";
import {
  captureMaintainedJournalBinding,
  readCheckedJournalActionRPC,
} from "../producer/classOwnedActionRoot.js";
export const observerIdentity = {
  subject: "observer",
  issuer: "https://host.test",
  tokenIdentifier: "https://host.test|observer",
};
export const readerControls = {
  grant: {} as Record<string, unknown>,
  args: {} as Record<string, unknown>,
  authorizations: 0,
  deny: false,
  reply: null as
    null | ((grant: Record<string, unknown>, count: number) => unknown),
};
export const authorizeObservation = queryGeneric({
  args: {
    componentScope: v.string(),
    parentOperationId: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    readerControls.authorizations++;
    const who = await ctx.auth.getUserIdentity();
    if (
      !who ||
      who.tokenIdentifier !== observerIdentity.tokenIdentifier ||
      readerControls.deny ||
      Object.entries(args).some(
        ([key, value]) => readerControls.args[key] !== value,
      )
    )
      return null;
    const snapshot = structuredClone(readerControls.grant);
    return readerControls.reply
      ? readerControls.reply(snapshot, readerControls.authorizations)
      : snapshot;
  },
});
export async function prepareObservationReader(
  h: Parameters<typeof historySnapshot>[0],
) {
  const full = await historySnapshot(h);
  const operationId = full.configure.operation.operationId;
  const parentOperationId = full.parent.operation.operationId;
  const binding = await captureMaintainedJournalBinding(h.sdk, {
    actualActionCtx: h.ctx,
    operationId,
  });
  const component = readCheckedJournalActionRPC(binding).component;
  const authorizationQuery = makeFunctionReference<
    "query",
    { componentScope: string; parentOperationId: string; operationId: string },
    unknown
  >("initialOwner:authorize");
  const entry = Object.freeze({
    component,
    componentScope: "trusted-installation-a",
    authorizationQuery,
  });
  admissionControls.history.splice(0, admissionControls.history.length, entry);
  h.core.owner.retire();
  vi.setSystemTime(
    (JSON.parse(full.configure.operation.recordJSON).configureRecord
      .configuration.preparation.expected.periodEnd +
      1) *
      1000,
  );
  readerControls.args = {
    componentScope: entry.componentScope,
    parentOperationId,
    operationId,
  };
  readerControls.grant = {
    ...readerControls.args,
    tokenIdentifier: observerIdentity.tokenIdentifier,
    providerScope: {
      mode: "platform",
      stripeAccount: null,
      livemode: false,
      customerAccountId: "acct_buyer",
      subscriptionId: "sub_original",
      scheduleId: "sub_sched_owned",
    },
    authorizationId: "fresh-observation",
    authorizationRevision: 3,
    expiresAtMs: Date.now() + 60000,
  };
  readerControls.authorizations = 0;
  readerControls.deny = false;
  readerControls.reply = null;
  return { full, operationId, parentOperationId, entry };
}
