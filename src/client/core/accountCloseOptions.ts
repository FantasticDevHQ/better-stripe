import type { AppliedConfiguration } from "../../component/core/validators.js";
import { z } from "zod";

export const closureConfigurations = z
  .array(z.enum(["customer", "merchant", "recipient"]))
  .max(3)
  .refine((values) => new Set(values).size === values.length);

export const closeAccountOptionsSchema = z
  .object({
    stripeAccountId: z
      .string()
      .regex(/^acct_[A-Za-z0-9_]+$/)
      .max(128),
    expectedAppliedConfigurations: closureConfigurations.optional(),
  })
  .strict();

/** Host-authenticated scope confirmation, not financial clearance. */
export type CloseAccountOptions = {
  stripeAccountId: string;
  expectedAppliedConfigurations?: AppliedConfiguration[];
};
