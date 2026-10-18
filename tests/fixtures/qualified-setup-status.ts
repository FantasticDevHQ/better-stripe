import type {
  BetterStripe,
  SetupIntentReadOptions,
  SetupIntentObservationStatus,
} from "@fantastic.dev/better-stripe";

type QualifiedStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "canceled"
  | "succeeded";

/** External strict consumer: use the public method's actual awaited result. */
export async function readQualifiedSetup(
  client: BetterStripe,
  ctx: Parameters<BetterStripe["getSetupIntentFromStripe"]>[0],
  original: SetupIntentReadOptions,
): Promise<{ status: QualifiedStatus }> {
  const observation = await client.getSetupIntentFromStripe(ctx, original);
  const status: QualifiedStatus = observation.status;
  return { status };
}

/** The named export and the method result must share the same closed contract. */
export function projectQualifiedStatus(
  status: SetupIntentObservationStatus,
): QualifiedStatus {
  return status;
}

export const supportedStatuses: SetupIntentObservationStatus[] = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "canceled",
  "succeeded",
];
