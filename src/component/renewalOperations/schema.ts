import { defineTable } from "convex/server";
import { v } from "convex/values";

export const stage = v.union(v.literal("attach"), v.literal("configure"));
const sequence = v.union(v.literal(1), v.literal(2), v.literal(3));
const payloadOwner = v.union(
  v.object({
    kind: v.literal("operation"),
    operationId: v.id("renewalOperations"),
  }),
  v.object({
    kind: v.literal("event"),
    operationId: v.id("renewalOperations"),
    attemptId: v.id("renewalOperationAttempts"),
    stage,
    sequence,
  }),
  v.object({
    kind: v.literal("receipt"),
    operationId: v.id("renewalOperations"),
    attemptId: v.id("renewalOperationAttempts"),
    stage,
  }),
);

/** Immutable creation, first reservation and bounded append-only stage DATA. */
export const payloadsTable = defineTable({
  codecVersion: v.literal(1),
  json: v.string(),
  // The operation link is filled before the creation transaction commits.
  owner: v.optional(payloadOwner),
});
const knownAcknowledgementFields = {
  schemaVersion: v.literal(1),
  stage: v.literal("attach"),
  attemptId: v.id("renewalOperationAttempts"),
  sourcePayloadId: v.id("renewalOperationPayloads"),
  dispatchEventId: v.id("renewalOperationEvents"),
  dispatchPayloadId: v.id("renewalOperationPayloads"),
  responseEventId: v.id("renewalOperationEvents"),
  responsePayloadId: v.id("renewalOperationPayloads"),
  receiptPayloadId: v.id("renewalOperationPayloads"),
  receiptBinding: v.string(),
};
export const knownAcknowledgement = v.object(knownAcknowledgementFields);
export const retainAcknowledgementArgs = {
  operationId: v.id("renewalOperations"),
  attemptId: v.id("renewalOperationAttempts"),
  expectedSequence: v.union(v.literal(2), v.literal(3)),
  receiptJSON: v.string(),
};
export const retentionReceipt = v.object({
  status: v.literal("retained"),
  operationId: v.id("renewalOperations"),
  ...knownAcknowledgementFields,
});
/** One complete retained receipt, without duplicating source or history DATA. */
export const providerAcknowledgementReadResult = v.union(
  v.null(),
  v.object({ retention: retentionReceipt, receiptJSON: v.string() }),
);
/** Closed unsigned basis DATA; not a clock, Origin or Owner capability. */
export const initialBasisDescriptor = v.object({
  version: v.literal(1),
  attemptId: v.id("renewalOperationAttempts"),
  sourcePayloadId: v.id("renewalOperationPayloads"),
  stage: v.literal("attach"),
  policyJSON: v.string(),
  basisJSON: v.string(),
});
export const operationsTable = defineTable({
  recordVersion: v.optional(v.literal(2)),
  initialBasis: v.optional(initialBasisDescriptor),
  authorizationScope: v.string(),
  authorizationId: v.string(),
  authorizationRevision: v.number(),
  logicalOperationId: v.string(),
  requestBinding: v.string(),
  payloadId: v.id("renewalOperationPayloads"),
  revision: v.union(v.literal(0), v.literal(1)),
  state: v.union(v.literal("PREPARED"), v.literal("RESERVED")),
  activeAttemptId: v.optional(v.id("renewalOperationAttempts")),
  knownAcknowledgement: v.optional(knownAcknowledgement),
}).index("by_authorizationScope_and_logicalOperationId", [
  "authorizationScope",
  "logicalOperationId",
]);

export const creationArgs = {
  authorizationScope: v.string(),
  logicalOperationId: v.string(),
  authorizationRevision: v.number(),
  recordJSON: v.string(),
};
export const creationResult = v.union(
  v.object({
    status: v.literal("created"),
    operationId: v.id("renewalOperations"),
  }),
  v.object({
    status: v.literal("existing"),
    operationId: v.id("renewalOperations"),
  }),
  v.object({
    status: v.literal("conflict"),
    reason: v.literal("identity_changed"),
  }),
);
const attemptFields = {
  operationId: v.id("renewalOperations"),
  payloadId: v.id("renewalOperationPayloads"),
  authorizationScope: v.string(),
  authorizationId: v.string(),
  authorizationRevision: v.number(),
  logicalOperationId: v.string(),
  requestBinding: v.string(),
  key: v.string(),
  apiVersion: v.string(),
  accountJSON: v.string(),
  firstDispatchedAt: v.number(),
  ordinal: v.literal(1),
  preparedRevision: v.literal(0),
  committedRevision: v.literal(1),
};
const legacyAttemptFields = {
  ...attemptFields,
  stage,
  basisJSON: v.string(),
};
const operationalAttemptFields = {
  ...attemptFields,
  recordVersion: v.literal(2),
  stage: v.literal("attach"),
  timingPolicyJSON: v.string(),
};
export const attemptsTable = defineTable(
  v.union(
    v.object({
      ...legacyAttemptFields,
      lastSequence: v.union(v.literal(0), sequence),
    }),
    v.object({
      ...operationalAttemptFields,
      lastSequence: v.union(v.literal(0), sequence),
    }),
  ),
).index("by_operationId", ["operationId"]);
export const reservationData = v.union(
  v.object({
    ...legacyAttemptFields,
    attemptId: v.id("renewalOperationAttempts"),
    recordJSON: v.string(),
  }),
  v.object({
    ...operationalAttemptFields,
    attemptId: v.id("renewalOperationAttempts"),
    recordJSON: v.string(),
  }),
);
// Loads return the complete record once, alongside checked attempt DATA.
const legacyReservationSummary = v.object({
  ...legacyAttemptFields,
  attemptId: v.id("renewalOperationAttempts"),
});
const operationalReservationSummary = v.object({
  ...operationalAttemptFields,
  attemptId: v.id("renewalOperationAttempts"),
});
export const reservationSummary = v.union(
  legacyReservationSummary,
  operationalReservationSummary,
);
export const reserveArgs = {
  operationId: v.id("renewalOperations"),
  expectedRevision: v.number(),
  stage,
  expectedRequestBinding: v.string(),
  recordJSON: v.string(),
};
export const reserveResult = v.union(
  v.object({
    disposition: v.literal("acquired"),
    previousRevision: v.literal(0),
    committedRevision: v.literal(1),
    reservation: reservationData,
  }),
  v.object({
    disposition: v.literal("existing"),
    committedRevision: v.literal(1),
    reservation: reservationData,
  }),
  v.object({
    disposition: v.literal("conflict"),
    reason: v.literal("identity_changed"),
  }),
);
export const loadedResult = v.union(
  v.null(),
  v.object({
    recordVersion: v.literal(2),
    operationId: v.id("renewalOperations"),
    recordJSON: v.string(),
    revision: v.literal(0),
    activeAttempt: v.null(),
    initialBasis: v.null(),
  }),
  v.object({
    recordVersion: v.literal(2),
    operationId: v.id("renewalOperations"),
    recordJSON: v.string(),
    revision: v.literal(1),
    activeAttempt: operationalReservationSummary,
    initialBasis: v.union(v.null(), initialBasisDescriptor),
  }),
  v.object({
    operationId: v.id("renewalOperations"),
    recordJSON: v.string(),
    revision: v.union(v.literal(0), v.literal(1)),
    activeAttempt: v.union(v.null(), legacyReservationSummary),
  }),
);

const eventFields = {
  operationId: v.id("renewalOperations"),
  attemptId: v.id("renewalOperationAttempts"),
  stage,
  sourcePayloadId: v.id("renewalOperationPayloads"),
  sequence,
  binding: v.string(),
  payloadId: v.id("renewalOperationPayloads"),
};
export const eventsTable = defineTable(eventFields).index(
  "by_attemptId_and_sequence",
  ["attemptId", "sequence"],
);
export const appendArgs = {
  reservation: reservationData,
  expectedSequence: v.number(),
  event: v.object({ sequence, binding: v.string(), dataJSON: v.string() }),
};
export const eventReceipt = v.object({
  ...eventFields,
  eventId: v.id("renewalOperationEvents"),
  reservation: reservationData,
});
export const eventDescriptor = v.object({
  ...eventFields,
  eventId: v.id("renewalOperationEvents"),
});
export const attemptResult = v.union(
  v.null(),
  v.object({
    reservation: reservationData,
    events: v.array(eventDescriptor),
  }),
);

export const bindInitialBasisArgs = {
  operationId: v.id("renewalOperations"),
  attemptId: v.id("renewalOperationAttempts"),
  policyJSON: v.string(),
  basisJSON: v.string(),
};
export const basisBindingReceipt = v.object({
  status: v.literal("bound"),
  operationId: v.id("renewalOperations"),
  initialBasis: initialBasisDescriptor,
});
