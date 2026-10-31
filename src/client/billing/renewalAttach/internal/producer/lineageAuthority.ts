import Stripe from "stripe";
import { types } from "node:util";
import { consumeInitialClassReservation } from "../operationJournal.js";
import { captureInitialJournalSelection } from "./classOwnedActionRoot.js";
import { canonicalInitialBasis } from "../../../../../shared/renewalOperationJournal.js";

const method = Object.getOwnPropertyDescriptor(
  Stripe.prototype,
  "rawRequest",
)?.value;
const u64 = 18446744073709551615n;
const timerLimit = 2147483647;
function stop(): never {
  throw Error("INITIAL_LINEAGE_UNBOUND");
}
const ms = (value: number) => Number.isSafeInteger(value) && value >= 0;

// Only this module mints identities. Retained journal DATA cannot construct one.
class InitialLineage {}
type Lineage = Readonly<{
  reservation: ReturnType<typeof consumeInitialClassReservation>["reservation"];
  selection: ReturnType<typeof captureInitialJournalSelection>;
  client: Stripe;
  method: Stripe["rawRequest"];
  basis: Readonly<{
    startWallMs: number;
    startNs: bigint;
    workEndWallMs: number;
    workEndNs: bigint;
    endWallMs: number;
    endNs: bigint;
  }>;
  basisJSON: string;
  initialHighNs: bigint;
  policy: Readonly<{
    firstDispatchedAt: number;
    periodStart: number;
    periodEnd: number;
  }>;
  wall: () => number;
  monotonic: () => bigint;
}>;
const lineages = new WeakMap<object, Lineage>();

/** Consumes original CAS custody before any selector, runtime clock or Owner. */
export function mintInitialLineage(
  call: unknown,
  journal: unknown,
  arity: number,
): object {
  const { reservation, binding } = consumeInitialClassReservation(
    call,
    journal,
  );
  if (arity !== 2) stop();
  if (
    !("recordVersion" in reservation) ||
    reservation.recordVersion !== 2 ||
    reservation.stage !== "attach" ||
    !("timingPolicyJSON" in reservation)
  )
    stop();
  const selection = captureInitialJournalSelection(
    binding,
    reservation.apiVersion,
  );
  const client = selection.select();
  if (
    !client ||
    typeof client !== "object" ||
    types.isProxy(client) ||
    Object.getPrototypeOf(client) !== Stripe.prototype ||
    Object.prototype.hasOwnProperty.call(client, "rawRequest") ||
    typeof method !== "function" ||
    Object.getOwnPropertyDescriptor(Stripe.prototype, "rawRequest")?.value !==
      method
  )
    stop();
  selection.check();
  const policy = JSON.parse(reservation.timingPolicyJSON) as {
    firstDispatchedAt: number;
    periodStart: number;
    periodEnd: number;
    workEndWallMs: number;
    endWallMs: number;
  };
  const wall = Date.now;
  const monotonic = process.hrtime.bigint;
  const lo = monotonic();
  const startWallMs = wall();
  const hi = monotonic();
  if (
    !ms(startWallMs) ||
    lo < 0n ||
    hi < lo ||
    hi > u64 ||
    hi - lo > 1000000n ||
    startWallMs >= policy.workEndWallMs ||
    policy.endWallMs - startWallMs > timerLimit
  )
    stop();
  const basis = Object.freeze({
    startWallMs,
    startNs: lo,
    workEndWallMs: policy.workEndWallMs,
    workEndNs:
      lo + (BigInt(policy.workEndWallMs) - BigInt(startWallMs)) * 1000000n,
    endWallMs: policy.endWallMs,
    endNs: lo + (BigInt(policy.endWallMs) - BigInt(startWallMs)) * 1000000n,
  });
  if (basis.endNs > u64) stop();
  const rawBasisJSON = JSON.stringify({
    startWallMs,
    startNsDecimal: lo.toString(),
    workEndWallMs: basis.workEndWallMs,
    workEndNsDecimal: basis.workEndNs.toString(),
    endWallMs: basis.endWallMs,
    endNsDecimal: basis.endNs.toString(),
  });
  const { basisJSON } = canonicalInitialBasis(
    reservation.timingPolicyJSON,
    rawBasisJSON,
  );
  selection.check();
  const token = Object.freeze(new InitialLineage());
  lineages.set(
    token,
    Object.freeze({
      reservation,
      selection,
      client: client as Stripe,
      method: method as Stripe["rawRequest"],
      basis,
      basisJSON,
      initialHighNs: hi,
      policy: Object.freeze({
        firstDispatchedAt: policy.firstDispatchedAt,
        periodStart: policy.periodStart,
        periodEnd: policy.periodEnd,
      }),
      wall,
      monotonic,
    }),
  );
  return token;
}

/** Opaque private identity required by every invocation kernel. */
export function readInitialLineage(token: object): Lineage {
  const lineage = lineages.get(token);
  if (!lineage) stop();
  lineage.selection.check();
  if (
    Object.getOwnPropertyDescriptor(Stripe.prototype, "rawRequest")?.value !==
      lineage.method ||
    Object.prototype.hasOwnProperty.call(lineage.client, "rawRequest") ||
    Object.getPrototypeOf(lineage.client) !== Stripe.prototype
  )
    stop();
  return lineage;
}
