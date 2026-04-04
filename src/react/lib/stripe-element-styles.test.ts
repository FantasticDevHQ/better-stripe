import { describe, expect, it } from "vitest";

import {
  createStripeAppearance,
  createStripeElementStyles,
  darkStripeAppearance,
  defaultStripeAppearance,
} from "./stripe-element-styles.js";

describe("createStripeAppearance", () => {
  it("returns light theme defaults when called with no args", () => {
    const appearance = createStripeAppearance();
    expect(appearance.theme).toBe("flat");
    expect(appearance.variables?.colorPrimary).toBe("#0570de");
    expect(appearance.variables?.colorBackground).toBe("#ffffff");
    expect(appearance.variables?.colorText).toBe("#30313d");
  });

  it("applies custom colors", () => {
    const appearance = createStripeAppearance({
      primary: "#ff0000",
      background: "#000000",
    });
    expect(appearance.variables?.colorPrimary).toBe("#ff0000");
    expect(appearance.variables?.colorBackground).toBe("#000000");
  });

  it("uses dark defaults for night theme", () => {
    const appearance = createStripeAppearance({ baseTheme: "night" });
    expect(appearance.theme).toBe("night");
    expect(appearance.variables?.colorPrimary).toBe("#7c3aed");
    expect(appearance.variables?.colorBackground).toBe("#1a1a2e");
  });

  it("includes Input rules with border color", () => {
    const appearance = createStripeAppearance({ border: "#cccccc" });
    const inputRule = appearance.rules?.[".Input"] as Record<string, string>;
    expect(inputRule.border).toContain("#cccccc");
  });

  it("includes focus rule with primary color", () => {
    const appearance = createStripeAppearance({ primary: "#123456" });
    const focusRule = appearance.rules?.[".Input:focus"] as Record<
      string,
      string
    >;
    expect(focusRule.borderColor).toBe("#123456");
    expect(focusRule.boxShadow).toContain("#123456");
  });

  it("includes invalid rule with danger color", () => {
    const appearance = createStripeAppearance({ danger: "#ff0000" });
    const invalidRule = appearance.rules?.[".Input--invalid"] as Record<
      string,
      string
    >;
    expect(invalidRule.borderColor).toBe("#ff0000");
  });
});

describe("createStripeElementStyles", () => {
  it("returns style object with base/invalid/empty", () => {
    const styles = createStripeElementStyles();
    expect(styles.style.base).toBeDefined();
    expect(styles.style.invalid).toBeDefined();
    expect(styles.style.empty).toBeDefined();
  });

  it("applies custom text color", () => {
    const styles = createStripeElementStyles({ text: "#111111" });
    expect(styles.style.base.color).toBe("#111111");
  });

  it("applies custom danger color to invalid state", () => {
    const styles = createStripeElementStyles({ danger: "#ff0000" });
    expect(styles.style.invalid.color).toBe("#ff0000");
    expect(styles.style.invalid.iconColor).toBe("#ff0000");
  });

  it("applies custom font family", () => {
    const styles = createStripeElementStyles({ fontFamily: "Monospace" });
    expect(styles.style.base.fontFamily).toBe("Monospace");
  });
});

describe("preset appearances", () => {
  it("defaultStripeAppearance uses flat theme", () => {
    expect(defaultStripeAppearance.theme).toBe("flat");
  });

  it("darkStripeAppearance uses night theme", () => {
    expect(darkStripeAppearance.theme).toBe("night");
  });
});
