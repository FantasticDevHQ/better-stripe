import { z } from "zod";
import { prepareRenewalPriceReplacement } from "../renewalPriceReplacement.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { object, readInput, equal, conflict, failure } from "./shared.js";
import { validateReadMaterial } from "./readMaterial.js";
export function retainedPreparation(value: unknown) {
  try {
    const candidate = object(value);
    const snapshot = object(candidate.providerSnapshot);
    const identity = object(candidate.requestIdentity);
    const prepared = prepareRenewalPriceReplacement({
      subscription: snapshot.subscription,
      targetPrice: snapshot.targetPrice,
      ...(snapshot.billingCustomer === undefined
        ? {}
        : { billingCustomer: snapshot.billingCustomer }),
      expected: candidate.expected as Parameters<
        typeof prepareRenewalPriceReplacement
      >[0]["expected"],
      key: z.string().parse(identity.key),
    });
    if (!equal(prepared, candidate)) conflict("invalid_prepared_binding");
    return prepared;
  } catch {
    return conflict("invalid_prepared_binding");
  }
}

export function validateReads(
  args: z.infer<typeof readInput>,
  scheduleId?: string,
) {
  return validateReadMaterial(
    args,
    retainedPreparation(args.prepared),
    scheduleId,
  );
}

export function preflightRenewalReplacement(input: unknown) {
  try {
    const args = readInput.parse(renewalSnapshot(input));
    const reads = validateReads(args);
    return {
      version: 1 as const,
      status: "preflighted_for_projection" as const,
      scope: "platform" as const,
      expected: reads.prepared.expected,
      quantity: reads.prepared.quantity,
      profile: reads.profile,
      providerQualification: "required" as const,
    };
  } catch (error) {
    return failure(error);
  }
}
