import type { UsagePlan } from "./contracts.js";
/** Server-safe configuration payload shared with the reusable React form. */
export type UsageConfigurationValue = {
  plan: UsagePlan;
  eventName: string;
  displayName: string;
  meterId?: string;
  creditPackage?: { quantity: string; topUp: "manual" };
};
