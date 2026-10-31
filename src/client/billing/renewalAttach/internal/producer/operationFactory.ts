import { readInitialLineage } from "./lineageAuthority.js";
import { journalWorkForInitialLineage } from "./journalWorkFactory.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { captureInitialStockRawDelegate } from "./stockDelegateFactory.js";
import { createInitialMaterialClassifiers } from "../material/classifiers.js";
import { captureRetainedInput } from "../material/capture.js";
import { captureAttachReceipt } from "../c10/eventCapture.js";
import { field, scalar } from "../c10/ownData.js";
import { materialize } from "../c10/eventCodec.js";

function stop(): never {
  throw Error("INITIAL_OPERATION_UNBOUND");
}
const operations = new WeakMap<object, ReturnType<typeof construct>>();

async function construct(token: object) {
  const lineage = readInitialLineage(token);
  const owner = ownerForInitialLineage(token);
  const owned = ownedAwaitForInitialLineage(token);
  const classified = await createInitialMaterialClassifiers(token).retained();
  owner.check();
  if (classified.status !== "classified") stop();
  const retained = JSON.parse(lineage.reservation.recordJSON);
  const original = captureRetainedInput({
    attachRequest: retained.attachRequest,
    originalBundle: retained.originalBundle,
  });
  const request = classified.material.completeRequest;
  const customer = classified.material.billingCustomer;
  if (!customer || typeof customer.id !== "string") stop();
  const query = String(
    new URLSearchParams(
      ["discounts", "items.data.discounts", "items.data.price"].map(
        (value, index) => ["expand[" + index + "]", value],
      ),
    ),
  );
  const rows = [
    {
      resource: "subscription",
      path:
        "/v1/subscriptions/" + request.payload.from_subscription + "?" + query,
    },
    {
      resource: "price",
      path: "/v1/prices/" + classified.material.targetPrice.id,
    },
    { resource: "customer", path: "/v1/customers/" + customer.id },
    ...original.originalBundle.couponReads.map((row) => {
      if (typeof row.couponId !== "string") stop();
      return {
        resource: "coupon",
        path: "/v1/coupons/" + encodeURIComponent(row.couponId),
      };
    }),
  ];
  const readPlan = Object.freeze(
    rows.map((row, index) =>
      Object.freeze({
        ...row,
        ordinal: index + 1,
        method: "GET",
        body: undefined,
        options: Object.freeze({
          apiVersion: request.apiVersion,
          maxNetworkRetries: 0,
        }),
      }),
    ),
  );
  const delegate = captureInitialStockRawDelegate(token);
  const send = journalWorkForInitialLineage(token).captureSend();
  let spent = false;
  const slot = Object.freeze({
    takeOnce(...args: unknown[]) {
      if (spent) return null;
      spent = true;
      if (args.length !== 1 || args[0] !== owner) return null;
      owner.check();
      return Object.freeze({
        rawAttachRequest: original.attachRequest,
        originalBundle: original.originalBundle,
      });
    },
  });
  const sink = Object.freeze({
    send(record: Parameters<typeof send>[0], ack: Parameters<typeof send>[1]) {
      return owned(() =>
        send(record, (value) => {
          owner.check();
          ack(value);
          owner.check();
        }),
      );
    },
  });
  owner.check();
  return Object.freeze({
    request,
    expected: classified.material.originalPrepared.expected,
    operation: Object.freeze({
      owner,
      originAssociation: lineage.originAssociation,
      slot,
      readPlan,
      delegate,
      sink,
    }),
  });
}

/** One construction and origin per original winning call; failures cannot remint. */
export function operationForInitialLineage(token: object) {
  if (arguments.length !== 1) stop();
  const owner = ownerForInitialLineage(token);
  owner.check();
  const owned = ownedAwaitForInitialLineage(token);
  let pending = operations.get(token);
  if (!pending) {
    pending = owned(async () => {
      try {
        return await construct(token);
      } catch (error) {
        owner.retire();
        throw error;
      }
    });
    operations.set(token, pending);
  }
  const captured = pending;
  return owned(() => captured);
}

/** Persist the fully captured C3 DATA before receipt3 or a returned ACK. */
export async function retainInitialReceiptForLineage(
  token: object,
  receipt: unknown,
) {
  if (arguments.length !== 2) stop();
  const owner = ownerForInitialLineage(token);
  owner.check();
  const lineage = readInitialLineage(token);
  const owned = ownedAwaitForInitialLineage(token);
  const frame = await owned(() => operationForInitialLineage(token));
  const captured = captureAttachReceipt({
    event: "receipt",
    stage: "attach",
    request: frame.request,
    receipt,
  });
  owner.check();
  const receiptNode = field(captured, "receipt");
  const binding = scalar(field(receiptNode, "binding"));
  if (typeof binding !== "string") stop();
  const receiptJSON = JSON.stringify(materialize(receiptNode));
  const retained = await owned(() =>
    journalWorkForInitialLineage(token).retain({
      attemptId: lineage.reservation.attemptId,
      expectedSequence: 2,
      receiptJSON,
    }),
  );
  owner.check();
  if (
    retained.status !== "retained" ||
    retained.schemaVersion !== 1 ||
    retained.stage !== "attach" ||
    retained.operationId !== lineage.reservation.operationId ||
    retained.attemptId !== lineage.reservation.attemptId ||
    retained.sourcePayloadId !== lineage.reservation.payloadId ||
    retained.receiptBinding !== binding
  )
    stop();
  return retained;
}
