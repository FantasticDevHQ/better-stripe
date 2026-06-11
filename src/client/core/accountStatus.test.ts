/**
 * Tests for deriveAccountStatus — verifies V2 account onboarding status
 * derivation from Stripe V2 requirements and configuration objects.
 */
import { describe, expect, it } from "vitest";

import type {
  V2AccountConfigCustomer,
  V2AccountConfigMerchant,
  V2AccountRequirementsEntry,
} from "../stripe-types.js";
import { deriveAccountStatus } from "./accountStatus.js";

/** Helper to create a V2 Requirements.Entry with sensible defaults */
function makeEntry(
  description: string,
  overrides?: Partial<V2AccountRequirementsEntry>,
): V2AccountRequirementsEntry {
  return {
    description,
    awaiting_action_from: "user",
    errors: [],
    impact: { restricts_capabilities: [] },
    minimum_deadline: { status: "currently_due" },
    requested_reasons: [],
    ...overrides,
  };
}

describe("deriveAccountStatus", () => {
  it("returns pending when no requirements and no config", () => {
    const status = deriveAccountStatus({});
    expect(status.onboardingStatus).toBe("pending");
    expect(status.missingRequirements).toEqual([]);
  });

  it("returns in_progress when requirements entries exist", () => {
    const status = deriveAccountStatus({
      requirements: {
        entries: [makeEntry("business_url")],
      },
    });
    expect(status.onboardingStatus).toBe("in_progress");
    expect(status.missingRequirements).toContain("business_url");
  });

  it("returns in_progress when requirements are pending verification by Stripe", () => {
    const status = deriveAccountStatus({
      requirements: {
        entries: [
          makeEntry("identity_document", {
            awaiting_action_from: "stripe",
          }),
        ],
      },
    });
    expect(status.onboardingStatus).toBe("in_progress");
    expect(status.missingRequirements).toContain("identity_document");
  });

  it("returns restricted when deadline status is past_due", () => {
    const status = deriveAccountStatus({
      requirements: {
        entries: [makeEntry("tos_acceptance")],
        summary: {
          minimum_deadline: {
            status: "past_due",
          },
        },
      },
    });
    expect(status.onboardingStatus).toBe("restricted");
    expect(status.missingRequirements).toContain("tos_acceptance");
  });

  it("returns complete when all configurations are applied", () => {
    const status = deriveAccountStatus({
      configuration: {
        customer: {
          applied: true,
        } as V2AccountConfigCustomer,
        merchant: {
          applied: true,
        } as V2AccountConfigMerchant,
      },
    });
    expect(status.onboardingStatus).toBe("complete");
    expect(status.missingRequirements).toEqual([]);
  });

  it("deduplicates missingRequirements across requirement entries", () => {
    const status = deriveAccountStatus({
      requirements: {
        entries: [makeEntry("email"), makeEntry("email"), makeEntry("name")],
      },
    });
    expect(status.missingRequirements).toHaveLength(2);
    expect(new Set(status.missingRequirements)).toEqual(
      new Set(["email", "name"]),
    );
  });
});
