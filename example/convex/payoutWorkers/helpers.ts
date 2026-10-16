import { v } from "convex/values";

export const kinds = ["policies", "recovering", "expiry", "changing"] as const;

export const kind = v.union(...kinds.map((k) => v.literal(k)));
