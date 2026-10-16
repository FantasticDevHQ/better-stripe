import type { QueryCtx } from "../_generated/server";

import type { Id } from "../_generated/dataModel";

// Demo persona binding only. A client-selected user ID is not authentication.
export async function viewer(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (!user || !["affiliate", "admin"].includes(user.role)) return null;
  return user;
}
