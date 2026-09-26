import {
  createUseEarnings,
  createUseSplitBreakdown,
} from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";

/**
 * App-bound instances of the better-stripe hook factories (BTS-36/37). The
 * factories are storage-agnostic — they take Convex's `useQuery` (which honors
 * the `"skip"` sentinel) plus the app-level query wrappers that reach the
 * component's transfer/payout ledgers. Used by the affiliate-split demo
 * (BTS-43).
 */
export const useSplitBreakdown = createUseSplitBreakdown(
  useQuery,
  api.queries.listTransfersByCharge,
);

export const useEarnings = createUseEarnings(
  useQuery,
  api.queries.listTransfersByAccount,
  api.queries.listPayoutsByAccount,
);
