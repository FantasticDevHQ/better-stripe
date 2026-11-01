import type { QueryCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import { readCheckedOperation } from "../renewalOperations/operationContext.js";
import {
  currentReservation,
  eventChain,
  validateV2KnownAcknowledgement,
} from "../renewalOperations/helpers.js";
import { sameJSON } from "../renewalOperations/attachValidation.js";
import { validateConfigureAcknowledgement } from "../renewalOperations/configureAcknowledgement.js";
import { constructRenewalConfigurationReceiptV2 } from "../../client/billing/renewalV2/index.js";
import {
  witnessIdentity,
  witnessNeed as need,
  witnessObject as object,
  witnessClosed as closed,
  type WitnessIdentity,
  type WitnessPayload,
} from "../../shared/renewalWitness.js";

type Reader = Pick<QueryCtx, "db">;
export function normalizedWitnessIdentity(ctx: Reader, raw: WitnessIdentity) {
  const value = witnessIdentity(raw);
  const parentOperationId = ctx.db.normalizeId(
    "renewalOperations",
    value.parentOperationId,
  );
  const operationId = ctx.db.normalizeId(
    "renewalOperations",
    value.operationId,
  );
  need(parentOperationId && operationId);
  return { ...value, parentOperationId, operationId };
}
async function checkedStage(
  ctx: Reader,
  operationId: Id<"renewalOperations">,
  stage: "attach" | "configure",
) {
  const row = await ctx.db.get("renewalOperations", operationId);
  need(row && row.recordVersion === 2);
  const full = await readCheckedOperation(ctx, row);
  const reservation = await currentReservation(ctx, row, full);
  need(
    reservation &&
      "recordVersion" in reservation &&
      reservation.stage === stage,
  );
  const events = await eventChain(ctx, reservation);
  const known = await validateV2KnownAcknowledgement(
    ctx,
    row,
    full,
    reservation,
    events,
  );
  if (stage === "configure" && events.length > 0) {
    const original = object(JSON.parse(full.json));
    const request = object(original.configureRecord).request;
    need(
      sameJSON(JSON.parse(events[0].dataJSON), {
        event: "dispatch",
        stage: "configure",
        request,
      }),
    );
    if (events.length === 3) need(known);
    if (events.length >= 2 && !known) {
      const response = closed(JSON.parse(events[1].dataJSON), [
        "event",
        "stage",
        "request",
        "body",
        "transport",
      ]);
      need(
        response.event === "response" &&
          response.stage === "configure" &&
          sameJSON(response.request, request),
      );
      type Input = Parameters<typeof constructRenewalConfigurationReceiptV2>[0];
      const receipt = await constructRenewalConfigurationReceiptV2({
        configuration: object(original.configureRecord)
          .configuration as Input["configuration"],
        actualDispatch: original.dispatch as Input["actualDispatch"],
        providerSnapshot: object(response.body),
        transport: object(response.transport) as Input["transport"],
      });
      await validateConfigureAcknowledgement(
        full,
        reservation,
        events,
        JSON.stringify(receipt),
      );
    }
  }
  if (stage === "attach")
    need(events.length === 3 && known && row.initialBasis);
  const { recordJSON: _recordJSON, ...summary } = reservation;
  void _recordJSON;
  const acknowledgement =
    known === null
      ? null
      : {
          retention: {
            status: "retained" as const,
            operationId,
            ...known.retained,
          },
          receipt: JSON.parse(known.admitted.receiptJSON) as Record<
            string,
            unknown
          >,
        };
  return {
    record: JSON.parse(full.json) as Record<string, unknown>,
    reservation: summary,
    acknowledgement,
    initialBasis: row.initialBasis,
  };
}
/** Reload complete actual chains/owners on every boundary; never trust stored flags. */
export async function validateWitnessSource(
  ctx: Reader,
  value: WitnessPayload,
) {
  const identity = normalizedWitnessIdentity(ctx, value.identity);
  const parent = await checkedStage(ctx, identity.parentOperationId, "attach");
  const child = await checkedStage(ctx, identity.operationId, "configure");
  need(
    object(child.record.parentAttachment).operationId ===
      identity.parentOperationId,
  );
  need(parent.initialBasis && parent.acknowledgement);
  const includeC9 = value.source.configure.acknowledgement !== null;
  if (includeC9) need(child.acknowledgement);
  const expected = {
    parent: {
      record: parent.record,
      reservation: parent.reservation,
      initialBasis: parent.initialBasis,
      acknowledgement: parent.acknowledgement,
    },
    configure: {
      record: child.record,
      reservation: child.reservation,
      acknowledgement: includeC9 ? child.acknowledgement : null,
    },
  };
  need(sameJSON(value.source, expected));
  // A later valid C9 is checked above but cannot be injected into captured-null DATA.
  return {
    identity,
    configuration: object(child.record.configureRecord).configuration,
    dispatch: child.record.dispatch,
  };
}
