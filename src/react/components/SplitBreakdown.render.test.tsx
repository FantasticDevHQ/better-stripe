/**
 * Behavioral render tests for <SplitBreakdown> (BTS-37).
 *
 * SplitBreakdown is a pure, hook-free presentational component consuming the
 * `useSplitBreakdown` hook's totals (BTS-36), so we render it to a static HTML
 * string with react-dom/server (no jsdom) and assert on the markup:
 *   - loading / empty states
 *   - the store + affiliate + platform lines (formatted amounts)
 *   - the "other" line appearing only when non-zero
 *   - the EXPLICIT unknown state when the platform share is undefined
 *     (no sale amount was provided to the hook)
 *   - label overrides, className, and the render-prop escape hatch
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SplitBreakdown as BarrelExport } from "../index.js";
import {
  SplitBreakdown,
  type SplitBreakdownRenderProps,
} from "./SplitBreakdown.js";

const leg = (over: Record<string, unknown>) => ({
  stripeTransferId: "tr_x",
  destinationAccountId: "acct_x",
  role: "other" as const,
  amount: 0,
  reversedAmount: 0,
  net: 0,
  currency: "usd",
  ...over,
});

const totals = {
  legs: [
    leg({ stripeTransferId: "tr_store", role: "store", amount: 8000, net: 8000 }),
    leg({ stripeTransferId: "tr_aff", role: "affiliate", amount: 1000, net: 1000 }),
  ],
  store: 8000,
  affiliate: 1000,
  other: 0,
  recipientsTotal: 9000,
  platform: 1000,
};

describe("SplitBreakdown", () => {
  it("renders the loading label while the sale's legs are pending", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, { breakdown: null, isLoading: true }),
    );
    expect(html).toContain("Loading split…");
    expect(html).toContain('role="status"');
  });

  it("renders the empty label when there is no breakdown", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, { breakdown: null }),
    );
    expect(html).toContain("No split recorded for this sale");
  });

  it("renders store, affiliate, and platform lines with formatted amounts", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, { breakdown: totals }),
    );
    expect(html).toContain("Store");
    expect(html).toContain("$80.00");
    expect(html).toContain("Affiliate");
    expect(html).toContain("$10.00");
    expect(html).toContain("Platform");
    expect(html).toContain("$10.00");
    // Zero "other" bucket stays hidden.
    expect(html).not.toContain("Other");
  });

  it("renders the other line when role-less legs carry money", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, {
        breakdown: {
          ...totals,
          legs: [...totals.legs, leg({ stripeTransferId: "tr_misc", amount: 500, net: 500 })],
          other: 500,
          recipientsTotal: 9500,
          platform: 500,
        },
      }),
    );
    expect(html).toContain("Other");
    expect(html).toContain("$5.00");
  });

  it("shows an explicit unknown state when the platform share is undefined", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, {
        breakdown: { ...totals, platform: undefined },
      }),
    );
    expect(html).toContain("Platform");
    expect(html).toContain("Unknown without the sale amount");
  });

  it("honours label overrides", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, {
        breakdown: totals,
        labels: { store: "Creator", platform: "Marketplace cut" },
        platformUnknownLabel: "n/a",
      }),
    );
    expect(html).toContain("Creator");
    expect(html).toContain("Marketplace cut");
  });

  it("applies className to the root element", () => {
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, {
        breakdown: totals,
        className: "split-card",
      }),
    );
    expect(html).toContain('class="split-card"');
  });

  it("invokes the children render-prop with the computed lines", () => {
    let received: SplitBreakdownRenderProps | undefined;
    const html = renderToStaticMarkup(
      createElement(SplitBreakdown, {
        breakdown: totals,
        children: (props: SplitBreakdownRenderProps) => {
          received = props;
          return createElement("p", null, String(props.lines.length));
        },
      }),
    );
    expect(received!.breakdown).toBe(totals);
    expect(received!.lines).toEqual([
      { key: "store", label: "Store", amount: 8000, amountLabel: "$80.00" },
      { key: "affiliate", label: "Affiliate", amount: 1000, amountLabel: "$10.00" },
      { key: "platform", label: "Platform", amount: 1000, amountLabel: "$10.00" },
    ]);
    expect(html).toBe("<p>3</p>");
  });

  it("marks the platform line with an undefined amount in the render-prop when unknown", () => {
    let received: SplitBreakdownRenderProps | undefined;
    renderToStaticMarkup(
      createElement(SplitBreakdown, {
        breakdown: { ...totals, platform: undefined },
        children: (props: SplitBreakdownRenderProps) => {
          received = props;
          return null;
        },
      }),
    );
    const platform = received!.lines.find((l) => l.key === "platform");
    expect(platform).toEqual({
      key: "platform",
      label: "Platform",
      amount: undefined,
      amountLabel: "Unknown without the sale amount",
    });
  });

  it("exports from the correct module via the react barrel", () => {
    expect(BarrelExport).toBe(SplitBreakdown);
  });
});
