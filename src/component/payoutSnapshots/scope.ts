import { v } from "convex/values";
export { validateIdentity } from "../payoutRelease/helpers.js";
export const identity = {
  accountId: v.string(),
  ownerKey: v.string(),
  operationKey: v.string(),
};
