import { describe, expect, it } from "vitest";

import {
  getRequirementKey,
  getRequirementLabel,
} from "./connect-requirement-keys.js";

describe("getRequirementKey", () => {
  it("returns mapped key for known fields", () => {
    expect(getRequirementKey("business_profile.url")).toBe(
      "stripe.requirements.businessUrl",
    );
    expect(getRequirementKey("external_account")).toBe(
      "stripe.requirements.bankAccount",
    );
    expect(getRequirementKey("individual.first_name")).toBe(
      "stripe.requirements.firstName",
    );
    expect(getRequirementKey("tos_acceptance.date")).toBe(
      "stripe.requirements.tosAcceptance",
    );
  });

  it("deduplicates DOB fields to the same key", () => {
    const day = getRequirementKey("individual.dob.day");
    const month = getRequirementKey("individual.dob.month");
    const year = getRequirementKey("individual.dob.year");
    expect(day).toBe("stripe.requirements.dateOfBirth");
    expect(month).toBe(day);
    expect(year).toBe(day);
  });

  it("generates fallback key for unknown fields", () => {
    expect(getRequirementKey("company.registration_number")).toBe(
      "stripe.requirements.company_registration_number",
    );
  });

  it("replaces dots with underscores in fallback", () => {
    expect(getRequirementKey("a.b.c")).toBe("stripe.requirements.a_b_c");
  });
});

describe("getRequirementLabel", () => {
  it("returns default labels for known fields", () => {
    expect(getRequirementLabel("business_profile.url")).toBe(
      "Business website",
    );
    expect(getRequirementLabel("external_account")).toBe("Bank account");
    expect(getRequirementLabel("individual.email")).toBe("Email address");
    expect(getRequirementLabel("tos_acceptance.date")).toBe("Terms of service");
  });

  it("falls back to last segment for unknown fields", () => {
    expect(getRequirementLabel("company.tax_id")).toBe("tax id");
  });

  it("allows overrides", () => {
    expect(
      getRequirementLabel("external_account", {
        external_account: "Routing + Account Number",
      }),
    ).toBe("Routing + Account Number");
  });

  it("override takes precedence over default label", () => {
    expect(
      getRequirementLabel("individual.email", {
        "individual.email": "Work Email",
      }),
    ).toBe("Work Email");
  });
});
