import { query, internalQuery } from "../_generated/server.js";
import { refFields, safeStatus, operationDoc } from "./schema.js";
import { read, status } from "./helpers.js";
export const get = query({
  args: refFields,
  returns: safeStatus,
  handler: async (ctx, args) => status(await read(ctx, args)),
});
/** Authorized host action reads the pinned public inputs; credentials are never stored here. */
export const snapshot = query({
  args: refFields,
  returns: operationDoc,
  handler: read,
});
export const saved = internalQuery({
  args: refFields,
  returns: operationDoc,
  handler: read,
});
