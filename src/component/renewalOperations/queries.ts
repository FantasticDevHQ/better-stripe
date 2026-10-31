import { v } from "convex/values";
import { query } from "../_generated/server.js";
import {
  originalRecord,
  currentReservation,
  eventChain,
  validateAttachAcknowledgement,
  validateKnownAcknowledgement,
  validateV2KnownAcknowledgement,
} from "./helpers.js";
import {
  loadedResult,
  attemptResult,
  providerAcknowledgementReadResult,
} from "./schema.js";

/** Full immutable DATA, not a dispatch or Owner capability. */
export const loadAuthorizedOperation = query({
  args: { operationId: v.id("renewalOperations") },
  returns: loadedResult,
  handler: async (ctx, args) => {
    const row = await ctx.db.get("renewalOperations", args.operationId);
    if (!row) return null;
    const full = await originalRecord(ctx, row);
    const reservation = await currentReservation(ctx, row, full);
    if (reservation && "recordVersion" in reservation) {
      const events = await eventChain(ctx, reservation);
      await validateV2KnownAcknowledgement(ctx, row, full, reservation, events);
    }
    if ("recordVersion" in full) {
      if (!reservation)
        return {
          recordVersion: 2 as const,
          operationId: row._id,
          recordJSON: full.json,
          revision: 0 as const,
          activeAttempt: null,
          initialBasis: null,
        };
      if (!("recordVersion" in reservation))
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const { recordJSON: _recordJSON, ...summary } = reservation;
      void _recordJSON;
      return {
        recordVersion: 2 as const,
        operationId: row._id,
        recordJSON: full.json,
        revision: 1 as const,
        activeAttempt: summary,
        initialBasis: row.initialBasis ?? null,
      };
    }
    if (reservation && "recordVersion" in reservation)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    let activeAttempt: Omit<
      NonNullable<typeof reservation>,
      "recordJSON"
    > | null = null;
    if (reservation) {
      const { recordJSON: _recordJSON, ...summary } = reservation;
      void _recordJSON;
      activeAttempt = summary;
    }
    return {
      operationId: row._id,
      recordJSON: full.json,
      revision: row.revision,
      activeAttempt,
    };
  },
});

/** Checked bounded manifest; complete event JSON is retained separately. */
export const readAttempt = query({
  args: {
    operationId: v.id("renewalOperations"),
    attemptId: v.id("renewalOperationAttempts"),
  },
  returns: attemptResult,
  handler: async (ctx, args) => {
    const row = await ctx.db.get("renewalOperations", args.operationId);
    if (!row) return null;
    const full = await originalRecord(ctx, row);
    const reservation = await currentReservation(ctx, row, full);
    if (!reservation || reservation.attemptId !== args.attemptId)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const checkedEvents = await eventChain(ctx, reservation);
    if ("recordVersion" in reservation)
      await validateV2KnownAcknowledgement(
        ctx,
        row,
        full,
        reservation,
        checkedEvents,
      );
    const events = checkedEvents.map((event) => {
      const { dataJSON: _dataJSON, ...descriptor } = event;
      void _dataJSON;
      return descriptor;
    });
    return { reservation, events };
  },
});

/** One complete event, scoped to the checked operation and active attempt. */
export const readStageEvent = query({
  args: {
    operationId: v.id("renewalOperations"),
    attemptId: v.id("renewalOperationAttempts"),
    sequence: v.union(v.literal(1), v.literal(2), v.literal(3)),
  },
  returns: v.union(
    v.null(),
    v.object({
      operationId: v.id("renewalOperations"),
      attemptId: v.id("renewalOperationAttempts"),
      stage: v.union(v.literal("attach"), v.literal("configure")),
      sourcePayloadId: v.id("renewalOperationPayloads"),
      sequence: v.union(v.literal(1), v.literal(2), v.literal(3)),
      binding: v.string(),
      payloadId: v.id("renewalOperationPayloads"),
      eventId: v.id("renewalOperationEvents"),
      dataJSON: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("renewalOperations", args.operationId);
    if (!row) return null;
    const full = await originalRecord(ctx, row);
    const reservation = await currentReservation(ctx, row, full);
    if (!reservation || reservation.attemptId !== args.attemptId)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const events = await eventChain(ctx, reservation);
    if ("recordVersion" in reservation)
      await validateV2KnownAcknowledgement(ctx, row, full, reservation, events);
    return events.find((event) => event.sequence === args.sequence) ?? null;
  },
});

/** Full retained acknowledgement DATA; never runtime ownership or replay authority. */
export const readProviderAcknowledgement = query({
  args: { operationId: v.id("renewalOperations") },
  returns: providerAcknowledgementReadResult,
  handler: async (ctx, { operationId }) => {
    try {
      const row = await ctx.db.get("renewalOperations", operationId);
      if (!row) return null;
      const full = await originalRecord(ctx, row);
      const reservation = await currentReservation(ctx, row, full);
      if (!reservation) {
        if (row.knownAcknowledgement !== undefined)
          throw Error("RENEWAL_JOURNAL_CONFLICT");
        return null;
      }
      const events = await eventChain(ctx, reservation);
      if ("recordVersion" in reservation) {
        const known = await validateV2KnownAcknowledgement(
          ctx,
          row,
          full,
          reservation,
          events,
        );
        if (known === null) return null;
        return {
          retention: {
            status: "retained" as const,
            operationId,
            ...known.retained,
          },
          receiptJSON: known.admitted.receiptJSON,
        };
      }
      if (row.knownAcknowledgement === undefined) return null;
      if (reservation.stage !== "attach")
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const payload = await ctx.db.get(
        "renewalOperationPayloads",
        row.knownAcknowledgement.receiptPayloadId,
      );
      if (!payload) throw Error("RENEWAL_JOURNAL_CONFLICT");
      const admitted = await validateAttachAcknowledgement(
        full,
        reservation,
        events,
        payload.json,
      );
      const retained = await validateKnownAcknowledgement(
        ctx,
        row,
        reservation,
        events,
        admitted,
      );
      if (retained === null) throw Error("RENEWAL_JOURNAL_CONFLICT");
      return {
        retention: { status: "retained" as const, operationId, ...retained },
        receiptJSON: admitted.receiptJSON,
      };
    } catch {
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    }
  },
});
