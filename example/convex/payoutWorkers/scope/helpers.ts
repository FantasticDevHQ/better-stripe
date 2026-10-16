import { v } from "convex/values";

export const recipient = { accountId: v.string(), ownerKey: v.string() };

export const scope = { ...recipient, currency: v.string() };
