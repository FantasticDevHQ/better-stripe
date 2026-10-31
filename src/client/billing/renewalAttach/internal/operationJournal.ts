import {
  captureMaintainedJournalBinding,
  readCheckedJournalActionRPC,
  type ClassActionInput,
} from "./producer/classOwnedActionRoot.js";
import type {
  GenericActionCtx,
  GenericDataModel,
  FunctionReturnType,
  FunctionArgs,
} from "convex/server";
import type { ComponentApi } from "../../../../component/_generated/component.js";
import { closed, type EventRecord } from "./c10/ownData.js";
import { renewalSnapshot } from "../../renewalReplacementSnapshot.js";
import {
  admitJournalValue,
  canonicalJournalEvent,
  canonicalJournalRecord,
  journalReservationMaterial,
} from "../../../../shared/renewalOperationJournal.js";

const classJournalBindings = new WeakMap<object, object>();
type Journal = ComponentApi["renewalOperations"];
type Reservation = FunctionArgs<
  Journal["mutations"]["appendStageEvent"]
>["reservation"];
type FreshReserveArgs = Omit<
  FunctionArgs<Journal["mutations"]["reserveAttempt"]>,
  "operationId"
>;
type FreshReserveResult = Readonly<{
  result: FunctionReturnType<Journal["mutations"]["reserveAttempt"]>;
  call: object | null;
}>;
type ConsumedReservation = Readonly<{
  reservation: Readonly<Reservation>;
  tag: object;
}>;
type ClassJournal = Awaited<ReturnType<typeof createActionOperationJournal>> &
  Readonly<{
    reserveFreshAttempt(args: FreshReserveArgs): Promise<FreshReserveResult>;
  }>;
type ReserveReply = FunctionReturnType<Journal["mutations"]["reserveAttempt"]>;
type WinningCallState = {
  spent: boolean;
  readonly journal: object;
  readonly binding: object;
  readonly rpc: ReturnType<typeof readCheckedJournalActionRPC>;
  readonly source: Awaited<ReturnType<typeof createActionOperationJournal>>;
  readonly reserve: Awaited<
    ReturnType<typeof createActionOperationJournal>
  >["reserveAttempt"];
  readonly request: Readonly<FreshReserveArgs>;
  readonly promise: Promise<ReserveReply>;
  readonly result: Extract<ReserveReply, { disposition: "acquired" }>;
  readonly reservation: Readonly<Reservation>;
};
const winningCalls = new WeakMap<object, WinningCallState>();
function callUnbound(): never {
  throw Error("CLASS_JOURNAL_CALL_UNBOUND");
}
type ActionContext = GenericActionCtx<GenericDataModel>;
type LoadedOperation = FunctionReturnType<
  ComponentApi["renewalOperations"]["queries"]["loadAuthorizedOperation"]
>;
function unbound(): never {
  throw Error("OPERATION_JOURNAL_ACTION_UNBOUND");
}

/** Private trusted-host capture only; metadata is not hostile-host attestation.
 * Fixed eight-reference DATA adapter; no class admission or fresh handle.
 * Component mutation replies are not runtime dispatch or Owner capabilities.
 */
export async function createActionOperationJournal(
  actualActionCtx: ActionContext,
  component: ComponentApi,
  operationId: string,
) {
  const metaReceiver = actualActionCtx.meta;
  const runQuery = actualActionCtx.runQuery;
  const runMutation = actualActionCtx.runMutation;
  if (
    !metaReceiver ||
    typeof metaReceiver.getFunctionMetadata !== "function" ||
    typeof runQuery !== "function" ||
    typeof runMutation !== "function" ||
    typeof operationId !== "string" ||
    operationId.length === 0
  )
    unbound();
  const getMetadata = metaReceiver.getFunctionMetadata;
  const references = Object.freeze({
    loadAuthorizedOperation:
      component.renewalOperations.queries.loadAuthorizedOperation,
    reserveAttempt: component.renewalOperations.mutations.reserveAttempt,
    bindInitialBasis: component.renewalOperations.mutations.bindInitialBasis,
    appendStageEvent: component.renewalOperations.mutations.appendStageEvent,
    readAttempt: component.renewalOperations.queries.readAttempt,
    readStageEvent: component.renewalOperations.queries.readStageEvent,
    retainProviderAcknowledgement:
      component.renewalOperations.mutations.retainProviderAcknowledgement,
    readProviderAcknowledgement:
      component.renewalOperations.queries.readProviderAcknowledgement,
  });
  const metadata = await getMetadata.call(metaReceiver);
  if (
    metadata.type !== "action" ||
    typeof metadata.name !== "string" ||
    metadata.name.length === 0 ||
    typeof metadata.componentPath !== "string"
  )
    unbound();
  const captured = Object.freeze({
    receiver: actualActionCtx,
    metaReceiver,
    getMetadata,
    runQuery,
    runMutation,
    references,
    operationId,
    metadata,
  });
  function checkCapture(): void {
    const binding = classJournalBindings.get(journal);
    if (binding) {
      const rpc = readCheckedJournalActionRPC(binding);
      if (
        rpc.receiver !== captured.receiver ||
        rpc.component !== component ||
        rpc.operationId !== captured.operationId ||
        rpc.runQuery !== captured.runQuery ||
        rpc.runMutation !== captured.runMutation ||
        rpc.metaReceiver !== captured.metaReceiver ||
        rpc.getMetadata !== captured.getMetadata
      )
        unbound();
    }
    if (
      captured.receiver.meta !== captured.metaReceiver ||
      captured.metaReceiver.getFunctionMetadata !== captured.getMetadata ||
      captured.receiver.runQuery !== captured.runQuery ||
      captured.receiver.runMutation !== captured.runMutation
    )
      unbound();
  }
  function checkArguments(args: object) {
    checkCapture();
    if (
      typeof args !== "object" ||
      args === null ||
      Array.isArray(args) ||
      "operationId" in args
    )
      unbound();
  }
  // Local DATA object custody only, not a fresh execution or provider permit.
  const reservations = new WeakMap<
    object,
    Readonly<{ reservation: Readonly<Reservation>; json: string }>
  >();
  function reservationJSON(value: unknown): string {
    try {
      const common = [
        "operationId",
        "attemptId",
        "payloadId",
        "authorizationScope",
        "authorizationId",
        "authorizationRevision",
        "logicalOperationId",
        "requestBinding",
        "key",
        "apiVersion",
        "accountJSON",
        "firstDispatchedAt",
        "ordinal",
        "preparedRevision",
        "committedRevision",
        "recordJSON",
        "stage",
      ];
      const operational =
        value !== null &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, "recordVersion");
      const own = closed(value, [
        ...common,
        ...(operational
          ? ["recordVersion", "timingPolicyJSON"]
          : ["basisJSON"]),
      ]);
      if (
        typeof own.recordJSON !== "string" ||
        typeof own.attemptId !== "string" ||
        own.attemptId.length === 0 ||
        typeof own.payloadId !== "string" ||
        own.payloadId.length === 0
      )
        unbound();
      const full = canonicalJournalRecord(own.recordJSON);
      const expected = {
        operationId: captured.operationId,
        attemptId: own.attemptId,
        payloadId: own.payloadId,
        authorizationScope: full.authorizationScope,
        authorizationId: full.authorizationId,
        authorizationRevision: full.authorizationRevision,
        logicalOperationId: full.logicalOperationId,
        requestBinding: full.requestBinding,
        ordinal: 1,
        preparedRevision: 0,
        committedRevision: 1,
        recordJSON: full.json,
        ...journalReservationMaterial(full),
      };
      if (
        Object.keys(expected).length !== Object.keys(own).length ||
        !Object.entries(expected).every(([key, value]) => own[key] === value)
      )
        unbound();
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(own).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
      );
    } catch {
      unbound();
    }
  }
  const journal = Object.freeze({
    createC10Send(
      actualReservation: Reservation,
    ): (
      record: Readonly<EventRecord>,
      ack: (value: unknown) => void,
    ) => Promise<void> {
      checkCapture();
      const found = reservations.get(actualReservation);
      if (!found || reservationJSON(actualReservation) !== found.json)
        unbound();
      const saved = found;
      let busy = false;
      let stopped = false;
      function gate() {
        checkCapture();
        if (stopped || reservationJSON(actualReservation) !== saved.json)
          unbound();
      }
      return async (record, ack) => {
        if (busy || stopped) {
          stopped = true;
          unbound();
        }
        busy = true;
        try {
          gate();
          if (typeof ack !== "function") unbound();
          const own = closed(record, ["sequence", "binding", "data"]);
          const sequence = own.sequence;
          const binding = own.binding;
          if (
            (sequence !== 1 && sequence !== 2 && sequence !== 3) ||
            typeof binding !== "string"
          )
            unbound();
          const event = await canonicalJournalEvent(
            sequence,
            JSON.stringify(renewalSnapshot(own.data)),
          );
          gate();
          if (event.binding !== binding) unbound();
          const args: FunctionArgs<Journal["mutations"]["appendStageEvent"]> = {
            reservation: saved.reservation,
            expectedSequence: sequence - 1,
            event: { sequence, binding, dataJSON: event.json },
          };
          admitJournalValue(args);
          const reply: FunctionReturnType<
            Journal["mutations"]["appendStageEvent"]
          > = await captured.runMutation.call(
            captured.receiver,
            captured.references.appendStageEvent,
            args,
          );
          gate();
          const result = closed(reply, [
            "operationId",
            "attemptId",
            "stage",
            "sourcePayloadId",
            "sequence",
            "binding",
            "payloadId",
            "eventId",
            "reservation",
          ]);
          if (
            result.operationId !== captured.operationId ||
            result.attemptId !== saved.reservation.attemptId ||
            result.stage !== saved.reservation.stage ||
            result.sourcePayloadId !== saved.reservation.payloadId ||
            result.sequence !== sequence ||
            result.binding !== binding ||
            typeof result.payloadId !== "string" ||
            result.payloadId.length === 0 ||
            result.payloadId === saved.reservation.payloadId ||
            typeof result.eventId !== "string" ||
            result.eventId.length === 0 ||
            reservationJSON(result.reservation) !== saved.json
          )
            unbound();
          gate();
          ack(Object.freeze({ sequence, binding }));
        } catch (error) {
          stopped = true;
          throw error;
        } finally {
          busy = false;
        }
      };
    },
    async loadAuthorizedOperation(): Promise<LoadedOperation> {
      checkCapture();
      return captured.runQuery.call(
        captured.receiver,
        captured.references.loadAuthorizedOperation,
        { operationId: captured.operationId },
      );
    },
    async reserveAttempt(
      args: Omit<
        FunctionArgs<Journal["mutations"]["reserveAttempt"]>,
        "operationId"
      >,
    ): Promise<FunctionReturnType<Journal["mutations"]["reserveAttempt"]>> {
      checkArguments(args);
      const reply: FunctionReturnType<Journal["mutations"]["reserveAttempt"]> =
        await captured.runMutation.call(
          captured.receiver,
          captured.references.reserveAttempt,
          { ...args, operationId: captured.operationId },
        );
      checkCapture();
      if (reply.disposition !== "conflict") {
        const json = reservationJSON(reply.reservation);
        reservations.set(
          reply.reservation,
          Object.freeze({
            reservation: Object.freeze({ ...reply.reservation }),
            json,
          }),
        );
      }
      return reply;
    },
    async bindInitialBasis(
      args: Omit<
        FunctionArgs<Journal["mutations"]["bindInitialBasis"]>,
        "operationId"
      >,
    ): Promise<FunctionReturnType<Journal["mutations"]["bindInitialBasis"]>> {
      checkArguments(args);
      return captured.runMutation.call(
        captured.receiver,
        captured.references.bindInitialBasis,
        { ...args, operationId: captured.operationId },
      );
    },
    async appendStageEvent(
      args: FunctionArgs<Journal["mutations"]["appendStageEvent"]>,
    ): Promise<FunctionReturnType<Journal["mutations"]["appendStageEvent"]>> {
      checkArguments(args);
      if (
        !args.reservation ||
        args.reservation.operationId !== captured.operationId
      )
        unbound();
      return captured.runMutation.call(
        captured.receiver,
        captured.references.appendStageEvent,
        args,
      );
    },
    async readAttempt(
      args: Omit<
        FunctionArgs<Journal["queries"]["readAttempt"]>,
        "operationId"
      >,
    ): Promise<FunctionReturnType<Journal["queries"]["readAttempt"]>> {
      checkArguments(args);
      return captured.runQuery.call(
        captured.receiver,
        captured.references.readAttempt,
        { ...args, operationId: captured.operationId },
      );
    },
    async readStageEvent(
      args: Omit<
        FunctionArgs<Journal["queries"]["readStageEvent"]>,
        "operationId"
      >,
    ): Promise<FunctionReturnType<Journal["queries"]["readStageEvent"]>> {
      checkArguments(args);
      return captured.runQuery.call(
        captured.receiver,
        captured.references.readStageEvent,
        { ...args, operationId: captured.operationId },
      );
    },
    async retainProviderAcknowledgement(
      args: Omit<
        FunctionArgs<Journal["mutations"]["retainProviderAcknowledgement"]>,
        "operationId"
      >,
    ): Promise<
      FunctionReturnType<Journal["mutations"]["retainProviderAcknowledgement"]>
    > {
      checkArguments(args);
      return captured.runMutation.call(
        captured.receiver,
        captured.references.retainProviderAcknowledgement,
        { ...args, operationId: captured.operationId },
      );
    },
    async readProviderAcknowledgement(): Promise<
      FunctionReturnType<Journal["queries"]["readProviderAcknowledgement"]>
    > {
      checkCapture();
      return captured.runQuery.call(
        captured.receiver,
        captured.references.readProviderAcknowledgement,
        { operationId: captured.operationId },
      );
    },
  });
  return journal;
}

/** Maintained class/Action journal DATA and local call identity, not execution authority. */
export async function createClassActionOperationJournal(
  actualRoot: object,
  input: ClassActionInput,
): Promise<ClassJournal> {
  const binding = await captureMaintainedJournalBinding(actualRoot, input);
  const rpc = readCheckedJournalActionRPC(binding);
  const journal = await createActionOperationJournal(
    rpc.receiver,
    rpc.component,
    rpc.operationId,
  );
  if (readCheckedJournalActionRPC(binding) !== rpc) unbound();
  classJournalBindings.set(journal, binding);
  const reserve = journal.reserveAttempt;
  const classJournal: ClassJournal = Object.freeze({
    ...journal,
    async reserveFreshAttempt(
      args: FreshReserveArgs,
    ): Promise<FreshReserveResult> {
      const before = readCheckedJournalActionRPC(binding);
      if (before !== rpc) unbound();
      if (
        typeof args !== "object" ||
        args === null ||
        Array.isArray(args) ||
        "operationId" in args
      )
        unbound();
      const own = closed(args, [
        "expectedRevision",
        "stage",
        "expectedRequestBinding",
        "recordJSON",
      ]);
      if (
        typeof own.expectedRevision !== "number" ||
        (own.stage !== "attach" && own.stage !== "configure") ||
        typeof own.expectedRequestBinding !== "string" ||
        typeof own.recordJSON !== "string"
      )
        unbound();
      const request: FreshReserveArgs = Object.freeze({
        expectedRevision: own.expectedRevision,
        stage: own.stage,
        expectedRequestBinding: own.expectedRequestBinding,
        recordJSON: own.recordJSON,
      });
      const promise = reserve.call(journal, request);
      const result = await promise;
      if (readCheckedJournalActionRPC(binding) !== before) unbound();
      if (result.disposition !== "acquired")
        return Object.freeze({ result, call: null });
      const top = closed(result, [
        "disposition",
        "previousRevision",
        "committedRevision",
        "reservation",
      ]);
      const full = canonicalJournalRecord(request.recordJSON);
      if (
        top.disposition !== "acquired" ||
        top.previousRevision !== 0 ||
        top.committedRevision !== 1 ||
        top.reservation !== result.reservation ||
        request.expectedRevision !== 0 ||
        full.requestBinding !== request.expectedRequestBinding ||
        result.reservation.operationId !== before.operationId ||
        result.reservation.recordJSON !== full.json ||
        result.reservation.requestBinding !== full.requestBinding ||
        result.reservation.stage !== request.stage
      )
        unbound();
      Object.freeze(result.reservation);
      Object.freeze(result);
      const call = Object.freeze({});
      winningCalls.set(call, {
        spent: false,
        journal: classJournal,
        binding,
        rpc: before,
        source: journal,
        reserve,
        request,
        promise,
        result,
        reservation: result.reservation,
      });
      return Object.freeze({ result, call });
    },
  });
  classJournalBindings.set(classJournal, binding);
  return classJournal;
}

/** Spend the original local call before inspecting its expected journal. */
export function consumeClassReservation(
  call: unknown,
  expectedClassJournal: unknown,
): ConsumedReservation {
  if (typeof call !== "object" || call === null) callUnbound();
  const state = winningCalls.get(call);
  if (!state || state.spent) callUnbound();
  state.spent = true;
  try {
    if (
      arguments.length !== 2 ||
      typeof expectedClassJournal !== "object" ||
      expectedClassJournal === null ||
      classJournalBindings.get(expectedClassJournal) !== state.binding ||
      expectedClassJournal !== state.journal ||
      state.source.reserveAttempt !== state.reserve ||
      readCheckedJournalActionRPC(state.binding) !== state.rpc
    )
      callUnbound();
    return Object.freeze({
      reservation: state.reservation,
      tag: state.rpc.tag,
    });
  } catch {
    return callUnbound();
  }
}
