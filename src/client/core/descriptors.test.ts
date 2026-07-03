/**
 * Statement-descriptor suffix validation (BTS-32).
 *
 * Stripe's rules for dynamic descriptors (docs.stripe.com/get-started/account/
 * statement-descriptors): Latin characters, at least one letter, none of
 * < > \ ' " *, and the complete descriptor is capped at 22 characters. The
 * suffix is stored per seller account and applied to destination charges, so
 * invalid values must be rejected at storage/config time — loudly, not by
 * silent truncation of what a buyer sees on their card statement.
 */
import { describe, expect, it } from "vitest";

import { validateStatementDescriptorSuffix } from "./descriptors.js";

describe("validateStatementDescriptorSuffix", () => {
  it("returns the trimmed value for a valid suffix", () => {
    expect(validateStatementDescriptorSuffix("  MAYAS FITNESS  ")).toBe(
      "MAYAS FITNESS",
    );
  });

  it("accepts exactly 22 characters (the boundary)", () => {
    const suffix = "A".repeat(22);
    expect(validateStatementDescriptorSuffix(suffix)).toBe(suffix);
  });

  it("rejects 23 characters — no silent truncation of what buyers see", () => {
    expect(() => validateStatementDescriptorSuffix("A".repeat(23))).toThrow(
      /22/,
    );
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(() => validateStatementDescriptorSuffix("")).toThrow(/empty/i);
    expect(() => validateStatementDescriptorSuffix("   ")).toThrow(/empty/i);
  });

  it.each(["<", ">", "\\", "'", '"', "*"])(
    "rejects the disallowed character %s",
    (char) => {
      expect(() => validateStatementDescriptorSuffix(`STORE${char}NAME`)).toThrow(
        /character/i,
      );
    },
  );

  it("rejects a value with no letter (digits/punctuation only)", () => {
    expect(() => validateStatementDescriptorSuffix("12345")).toThrow(/letter/i);
    expect(() => validateStatementDescriptorSuffix("---  9")).toThrow(/letter/i);
  });

  it("rejects non-ASCII (non-Latin) characters", () => {
    expect(() => validateStatementDescriptorSuffix("CAFÉ MÜNCHEN")).toThrow(
      /character/i,
    );
  });

  it("accepts digits, spaces, and common punctuation alongside letters", () => {
    expect(validateStatementDescriptorSuffix("STORE-42 #1.COM")).toBe(
      "STORE-42 #1.COM",
    );
  });

  it("measures length AFTER trimming", () => {
    const suffix = `  ${"B".repeat(22)}  `;
    expect(validateStatementDescriptorSuffix(suffix)).toBe("B".repeat(22));
  });
});
