import { v } from "convex/values";
import { refundDocValidator } from "../connect/validators.js";

/** Observation and coverage only; no state here means provider absence or retry authority. */
export const refundCommandEvidenceValidator = v.union(
  v.object({ status: v.literal("observed"), refund: refundDocValidator }),
  v.object({
    status: v.literal("unavailable"),
    reason: v.union(
      v.literal("missing"),
      v.literal("normalization_incomplete"),
      v.literal("ambiguous"),
      v.literal("correlation_conflict"),
      v.literal("scope_mismatch"),
      v.literal("invalid_receipt"),
    ),
  }),
);
