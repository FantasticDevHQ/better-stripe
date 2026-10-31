import type { Infer } from "convex/values";
import { mutation } from "../_generated/server.js";
import {
  admitJournalValue,
  admitJournalStrings,
  canonicalJournalEvent,
  canonicalInitialBasis,
  canonicalJournalRecord,
} from "../../shared/renewalOperationJournal.js";
import {
  findOperation,
  validateOperationalAttachSource,
  originalRecord,
  currentReservation,
  checkedInitialBasis,
  reservationFields,
  reservationMatches,
  eventChain,
  validateAttachAcknowledgement,
  validateAttachReceiptEventDATA,
  validateKnownAcknowledgement,
  validateV2KnownAcknowledgement,
} from "./helpers.js";
import {
  creationArgs,
  creationResult,
  reserveArgs,
  reserveResult,
  appendArgs,
  eventReceipt,
  retainAcknowledgementArgs,
  retentionReceipt,
  knownAcknowledgement,
  bindInitialBasisArgs,
  basisBindingReceipt,
  initialBasisDescriptor,
} from "./schema.js";

/** Trusted host component API. Authorization policy remains outside the SDK. */
export const createAuthorizedOperation = mutation({
  args: creationArgs,
  returns: creationResult,
  handler: async (ctx, args) => {
    const full = canonicalJournalRecord(args.recordJSON);
    admitJournalStrings([
      full.authorizationScope,
      full.authorizationId,
      full.logicalOperationId,
      full.requestBinding,
    ]);
    const conflict = {
      status: "conflict" as const,
      reason: "identity_changed" as const,
    };
    if (
      full.authorizationScope !== args.authorizationScope ||
      full.logicalOperationId !== args.logicalOperationId ||
      full.authorizationRevision !== args.authorizationRevision
    )
      return conflict;
    await validateOperationalAttachSource(full);
    const existing = await findOperation(
      ctx,
      args.authorizationScope,
      args.logicalOperationId,
    );
    if (existing) {
      const original = await originalRecord(ctx, existing);
      if (original.json !== full.json) return conflict;
      if (existing.recordVersion === 2) {
        const current = await currentReservation(ctx, existing, original);
        if (current) {
          const events = await eventChain(ctx, current);
          await validateV2KnownAcknowledgement(
            ctx,
            existing,
            original,
            current,
            events,
          );
        }
      }
      return { status: "existing" as const, operationId: existing._id };
    }
    const payloadId = await ctx.db.insert("renewalOperationPayloads", {
      codecVersion: 1,
      json: full.json,
    });
    const operationId = await ctx.db.insert("renewalOperations", {
      ...("recordVersion" in full && full.recordVersion === 2
        ? { recordVersion: 2 as const }
        : {}),
      authorizationScope: full.authorizationScope,
      authorizationId: full.authorizationId,
      authorizationRevision: full.authorizationRevision,
      logicalOperationId: full.logicalOperationId,
      requestBinding: full.requestBinding,
      payloadId,
      revision: 0,
      state: "PREPARED",
    });
    // Link the actual operation before this transaction commits.
    await ctx.db.patch("renewalOperationPayloads", payloadId, {
      owner: { kind: "operation", operationId },
    });
    return { status: "created" as const, operationId };
  },
});

/** First CAS only. The transient acquired result is never stored or echoed. */
export const reserveAttempt = mutation({
  args: reserveArgs,
  returns: reserveResult,
  handler: async (ctx, args) => {
    const conflict = {
      disposition: "conflict" as const,
      reason: "identity_changed" as const,
    };
    const row = await ctx.db.get("renewalOperations", args.operationId);
    if (!row || args.expectedRevision !== 0) return conflict;
    const full = await originalRecord(ctx, row);
    const supplied = canonicalJournalRecord(args.recordJSON);
    if (
      supplied.json !== full.json ||
      args.expectedRequestBinding !== full.requestBinding
    )
      return conflict;
    const fields = reservationFields(row, full);
    if (args.stage !== fields.stage) return conflict;
    const current = await currentReservation(ctx, row, full);
    if (current) {
      if ("recordVersion" in current) {
        const events = await eventChain(ctx, current);
        await validateV2KnownAcknowledgement(ctx, row, full, current, events);
      }
      return {
        disposition: "existing" as const,
        committedRevision: 1 as const,
        reservation: current,
      };
    }
    // This read of PREPARED and both writes commit atomically under Convex OCC.
    // A competing committed winner makes a rerun return existing above.
    if (row.knownAcknowledgement !== undefined) return conflict;
    const attemptId = await ctx.db.insert("renewalOperationAttempts", {
      ...fields,
      lastSequence: 0,
    });
    await ctx.db.patch("renewalOperations", row._id, {
      revision: 1,
      state: "RESERVED",
      activeAttemptId: attemptId,
    });
    return {
      disposition: "acquired" as const,
      previousRevision: 0 as const,
      committedRevision: 1 as const,
      reservation: { ...fields, attemptId, recordJSON: full.json },
    };
  },
});

/** Storage consistency only. A stored row is not actual C10 fulfillment. */
export const appendStageEvent = mutation({
  args: appendArgs,
  returns: eventReceipt,
  handler: async (ctx, args) => {
    admitJournalValue(args);
    const row = await ctx.db.get(
      "renewalOperations",
      args.reservation.operationId,
    );
    if (!row) throw Error("RENEWAL_JOURNAL_CONFLICT");
    const full = await originalRecord(ctx, row);
    const reservation = await currentReservation(ctx, row, full);
    if (!reservation || !reservationMatches(reservation, args.reservation))
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    if (
      row.recordVersion === 2 &&
      checkedInitialBasis(row, reservation.attemptId, reservation) === null
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    if (
      !Number.isSafeInteger(args.expectedSequence) ||
      args.expectedSequence < 0 ||
      args.expectedSequence > 2 ||
      args.event.sequence !== args.expectedSequence + 1
    )
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const incoming = await canonicalJournalEvent(
      args.event.sequence,
      args.event.dataJSON,
    );
    if (incoming.binding !== args.event.binding)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const events = await eventChain(ctx, reservation);
    const known =
      "recordVersion" in reservation
        ? await validateV2KnownAcknowledgement(
            ctx,
            row,
            full,
            reservation,
            events,
          )
        : null;
    if (known !== null && incoming.sequence === 3) {
      try {
        validateAttachReceiptEventDATA(incoming.json, known.admitted.receipt);
      } catch {
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      }
    }
    // Known receipt3 publication must match the full retained C3/source, even
    // on the identical-event duplicate branch below. Generic no-known DATA is
    // deliberately unchanged.
    if (
      !("recordVersion" in reservation) &&
      row.knownAcknowledgement !== undefined &&
      incoming.sequence === 3
    ) {
      try {
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
        await validateKnownAcknowledgement(
          ctx,
          row,
          reservation,
          events,
          admitted,
        );
        validateAttachReceiptEventDATA(incoming.json, admitted.receipt);
      } catch {
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      }
    }
    const prior = events.find((event) => event.sequence === incoming.sequence);
    if (prior) {
      if (
        prior.binding !== incoming.binding ||
        prior.dataJSON !== incoming.json
      )
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const { dataJSON: _dataJSON, ...receipt } = prior;
      void _dataJSON;
      return { ...receipt, reservation };
    }
    if (args.expectedSequence !== events.length)
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    const payloadId = await ctx.db.insert("renewalOperationPayloads", {
      codecVersion: 1,
      json: incoming.json,
      owner: {
        kind: "event",
        operationId: reservation.operationId,
        attemptId: reservation.attemptId,
        stage: reservation.stage,
        sequence: incoming.sequence,
      },
    });
    const fields = {
      operationId: reservation.operationId,
      attemptId: reservation.attemptId,
      stage: reservation.stage,
      sourcePayloadId: reservation.payloadId,
      sequence: incoming.sequence,
      binding: incoming.binding,
      payloadId,
    };
    const eventId = await ctx.db.insert("renewalOperationEvents", fields);
    await ctx.db.patch("renewalOperationAttempts", reservation.attemptId, {
      lastSequence: incoming.sequence,
    });
    return { ...fields, eventId, reservation };
  },
});

/** ATTACH retention at the checked head, with immutable known-DATA repeats. */
export const retainProviderAcknowledgement = mutation({
  args: retainAcknowledgementArgs,
  returns: retentionReceipt,
  handler: async (ctx, args) => {
    admitJournalValue(args);
    try {
      const row = await ctx.db.get("renewalOperations", args.operationId);
      if (!row) throw Error("RENEWAL_JOURNAL_CONFLICT");
      const full = await originalRecord(ctx, row);
      const reservation = await currentReservation(ctx, row, full);
      if (
        !reservation ||
        reservation.attemptId !== args.attemptId ||
        reservation.stage !== "attach"
      )
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      if (
        "recordVersion" in reservation &&
        checkedInitialBasis(row, reservation.attemptId, reservation) === null
      )
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const events = await eventChain(ctx, reservation);
      const head = events.length;
      if (
        (head !== 2 && head !== 3) ||
        args.expectedSequence > head ||
        (row.knownAcknowledgement === undefined &&
          args.expectedSequence !== head)
      )
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const admitted = await validateAttachAcknowledgement(
        full,
        reservation,
        events,
        args.receiptJSON,
      );
      const checkedKnown =
        "recordVersion" in reservation
          ? await validateV2KnownAcknowledgement(
              ctx,
              row,
              full,
              reservation,
              events,
            )
          : null;
      if (
        checkedKnown !== null &&
        checkedKnown.admitted.receiptJSON !== admitted.receiptJSON
      )
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const retained =
        checkedKnown === null
          ? await validateKnownAcknowledgement(
              ctx,
              row,
              reservation,
              events,
              admitted,
            )
          : checkedKnown.retained;
      if (retained !== null) {
        const result: Infer<typeof retentionReceipt> = {
          status: "retained",
          operationId: row._id,
          ...retained,
        };
        return result;
      }
      const receiptPayloadId = await ctx.db.insert("renewalOperationPayloads", {
        codecVersion: 1,
        json: admitted.receiptJSON,
        owner: {
          kind: "receipt",
          operationId: row._id,
          attemptId: reservation.attemptId,
          stage: "attach",
        },
      });
      const known: Infer<typeof knownAcknowledgement> = {
        schemaVersion: 1,
        stage: "attach",
        attemptId: reservation.attemptId,
        sourcePayloadId: reservation.payloadId,
        dispatchEventId: events[0].eventId,
        dispatchPayloadId: events[0].payloadId,
        responseEventId: events[1].eventId,
        responsePayloadId: events[1].payloadId,
        receiptPayloadId,
        receiptBinding: admitted.receiptBinding,
      };
      await ctx.db.patch("renewalOperations", row._id, {
        knownAcknowledgement: known,
      });
      const result: Infer<typeof retentionReceipt> = {
        status: "retained",
        operationId: row._id,
        ...known,
      };
      return result;
    } catch {
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    }
  },
});

/** Atomic first basis DATA binding; never mints a clock, Origin or Owner. */
export const bindInitialBasis = mutation({
  args: bindInitialBasisArgs,
  returns: basisBindingReceipt,
  handler: async (ctx, args) => {
    admitJournalValue(args);
    try {
      const row = await ctx.db.get("renewalOperations", args.operationId);
      if (!row || row.recordVersion !== 2)
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const full = await originalRecord(ctx, row);
      const reservation = await currentReservation(ctx, row, full);
      if (
        !reservation ||
        !("recordVersion" in reservation) ||
        reservation.attemptId !== args.attemptId
      )
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const normalized = canonicalInitialBasis(args.policyJSON, args.basisJSON);
      if (normalized.policyJSON !== reservation.timingPolicyJSON)
        throw Error("RENEWAL_JOURNAL_CONFLICT");
      const existing = checkedInitialBasis(
        row,
        reservation.attemptId,
        reservation,
      );
      const initialBasis: Infer<typeof initialBasisDescriptor> = {
        version: 1,
        attemptId: reservation.attemptId,
        sourcePayloadId: reservation.payloadId,
        stage: "attach",
        policyJSON: normalized.policyJSON,
        basisJSON: normalized.basisJSON,
      };
      if (existing !== null) {
        const events = await eventChain(ctx, reservation);
        await validateV2KnownAcknowledgement(
          ctx,
          row,
          full,
          reservation,
          events,
        );
        if (
          existing.policyJSON !== initialBasis.policyJSON ||
          existing.basisJSON !== initialBasis.basisJSON
        )
          throw Error("RENEWAL_JOURNAL_CONFLICT");
      }
      const result = {
        status: "bound" as const,
        operationId: row._id,
        initialBasis: existing ?? initialBasis,
      };
      admitJournalValue(result);
      if (existing === null)
        await ctx.db.patch("renewalOperations", row._id, { initialBasis });
      return result;
    } catch {
      throw Error("RENEWAL_JOURNAL_CONFLICT");
    }
  },
});
