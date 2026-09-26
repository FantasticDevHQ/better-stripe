/**
 * App-bound dispute hooks (BTS-44).
 *
 * The library ships the dispute hooks as factories so each app can bind them to
 * its own Convex query references. Here we bind them once to the example app's
 * `listDisputes` / `getDisputeWithCountdown` queries; the seller disputes page
 * consumes these like ordinary hooks.
 */
import {
  createUseDisputes,
  createUseDisputeWithCountdown,
} from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";

/** The seller's disputes (optionally scoped to their store account). */
export const useDisputes = createUseDisputes(useQuery, api.queries.listDisputes);

/** A single dispute with its evidence-due countdown, for DisputeDetail. */
export const useDisputeWithCountdown = createUseDisputeWithCountdown(
  useQuery,
  api.queries.getDisputeWithCountdown,
);
