import type { FunctionReference } from "convex/server";
import type { WitnessIdentity } from "../../../../../shared/renewalWitness.js";
import type {
  FreshObservationProfile,
  InvoiceObservationProfile,
} from "./sourceOperations.js";

export type WitnessScope = Readonly<{
  identity: WitnessIdentity;
  providerScope: Readonly<{
    mode: "platform";
    stripeAccount: null;
    livemode: boolean;
    customerAccountId: string;
    customerId: string;
    subscriptionId: string;
    scheduleId: string;
  }>;
  configureRequestBinding: string;
  observedItemId: string;
  nativePeriod: Readonly<{ start: number; end: number }>;
}>;
export type WitnessRetentionArgs = {
  capability: "renewal_witness_retain_v1";
  scope: WitnessScope;
};
export type WitnessReadArgs = {
  capability: "renewal_witness_read_v1";
  identity: WitnessIdentity;
};
type BaseProfile = Readonly<{
  freshProfile: FreshObservationProfile;
  invoiceProfile: InvoiceObservationProfile | null;
}>;
export type WitnessCaptureProfile = BaseProfile &
  Readonly<{
    authorizationQuery: FunctionReference<
      "query",
      "public" | "internal",
      WitnessRetentionArgs,
      unknown
    >;
  }>;
export type WitnessReadProfile = BaseProfile &
  Readonly<{
    authorizationQuery: FunctionReference<
      "query",
      "public" | "internal",
      WitnessReadArgs,
      unknown
    >;
  }>;

/** Fixed Source associations only. Returned DATA cannot populate these profiles. */
export const COMPILED_WITNESS_CAPTURE_ENTRIES: readonly WitnessCaptureProfile[] =
  Object.freeze([]);
export const COMPILED_WITNESS_READ_ENTRIES: readonly WitnessReadProfile[] =
  Object.freeze([]);
