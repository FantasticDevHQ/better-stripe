import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { originalRecord } from "./helpers.js";
import { configureConflict } from "./configureValidation.js";
import { validateConfigureParent } from "./configureParent.js";

/** Full source and parent checks for every stored operation API boundary. */
export async function readCheckedOperation(
  ctx: Pick<QueryCtx, "db">,
  row: Doc<"renewalOperations">,
) {
  const full = await originalRecord(ctx, row);
  const parent = await validateConfigureParent(ctx, full);
  if (
    parent &&
    row.initialBasis &&
    row.initialBasis.basisJSON !== parent.basisJSON
  )
    configureConflict();
  return full;
}
