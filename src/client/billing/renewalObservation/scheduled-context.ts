import { object, array, need, get, type O } from "./common.js";
import type { Purpose, Evidence } from "./common.js";
type Owned = { args: O; prepared: unknown; receipt: unknown; request: unknown };
/** Fixed internal V2 entry, called only after the public raw reconstruction succeeds. */
export function createContext(
  owned: Owned,
  material: unknown,
  purpose: Purpose,
  evidence?: Evidence,
) {
  const base = {
    candidateOnly: true,
    providerQualification: "required",
    configureAcknowledged: false,
    configureDispatchOutcome: "unknown",
    providerCallsRequested: false,
  } as const;
  const projection: O = { ...owned.args, prepared: owned.prepared };
  const request = object(owned.request),
    rawReads = material;
  const input: O = {
    retainedProjectionInput: projection,
    desiredRequest: request,
    reads: material,
  };
  const desired = object(request),
    prepared = get(projection, "prepared"),
    expected = get(prepared, "expected"),
    receipt = object(owned.receipt);
  const original = get(prepared, "providerSnapshot"),
    originalSub = get(original, "subscription"),
    originalItem = object(array(get(originalSub, "items").data)[0]);
  const originalSchedule = get(receipt, "providerSnapshot"),
    expectedPrice = get(original, "targetPrice");
  need(
    Object.prototype.hasOwnProperty.call(originalSub, "latest_invoice") &&
      Object.prototype.hasOwnProperty.call(
        object(object(material).subscription),
        "latest_invoice",
      ),
    "missing_latest_invoice",
    "unknown",
  );
  need(
    Object.keys(object(material)).every((k) =>
      [
        "schedule",
        "subscription",
        "targetPrice",
        "billingCustomer",
        "coupons",
      ].includes(k),
    ),
    "unsupported_read_bundle",
    "unknown",
  );
  const reads = object(material),
    schedule = get(reads, "schedule"),
    sub = get(reads, "subscription"),
    target = get(reads, "targetPrice"),
    customer = get(reads, "billingCustomer");
  // New public bare-wire boundary: do not let the inherited terminal matcher coerce values.
  need(
    typeof schedule.status === "string",
    "invalid_schedule_status",
    "unknown",
  );
  const context = {
    customerAccountId: String(expected.customerAccountId),
    livemode: expected.livemode as boolean,
  };
  // Only immutable retained templates or the separately correlated Customer GET
  // can justify discarding expansion structure in a comparison view.
  return {
    input,
    rawReads,
    base,
    purpose,
    evidence,
    projection,
    request,
    prepared,
    expected,
    receipt,
    original,
    originalSub,
    originalItem,
    originalSchedule,
    expectedPrice,
    reads,
    schedule,
    sub,
    target,
    customer,
    context,
    desired,
  };
}
