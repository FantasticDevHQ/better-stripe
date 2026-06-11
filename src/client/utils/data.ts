import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

// =============================================================================
// Data management
// =============================================================================

/**
 * Clear all data from the better-stripe component tables.
 * WARNING: This is destructive and irreversible. Use only for dev/test reset.
 */
export async function clearAll(
  component: Component,
  ctx: RunCtx,
): Promise<{ cleared: number; tables: string[] }> {
  return runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/clearAllTables"),
    {},
  );
}
