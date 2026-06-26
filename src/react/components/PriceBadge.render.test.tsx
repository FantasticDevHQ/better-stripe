/**
 * Behavioral render tests for <PriceBadge>.
 *
 * PriceBadge is a pure, hook-free presentational component, so we can render it
 * to a static HTML string with react-dom/server (no jsdom required) and assert
 * on the produced markup/text for each branch:
 *   - the "free" branch (unitAmount of 0, null, or undefined) → renders freeLabel
 *   - the "paid" branch → renders the interval-formatted price
 *   - the render-prop `children` path → receives the formatted string and its
 *     output replaces the default <span>
 * These tests matter because the free/paid threshold and the render-prop contract
 * are the component's whole job; a regression here silently misprices the UI.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PriceBadge } from "./PriceBadge.js";

describe("PriceBadge", () => {
  it("renders the default 'Free' label when unitAmount is 0", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, { unitAmount: 0, currency: "usd" }),
    );
    expect(html).toBe("<span>Free</span>");
  });

  it("treats null unitAmount as free", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, { unitAmount: null, currency: "usd" }),
    );
    expect(html).toContain("Free");
  });

  it("treats missing unitAmount as free", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, { currency: "usd" }),
    );
    expect(html).toContain("Free");
  });

  it("uses a custom freeLabel and applies className on the free branch", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 0,
        currency: "usd",
        freeLabel: "No charge",
        className: "badge",
      }),
    );
    expect(html).toBe('<span class="badge">No charge</span>');
  });

  it("renders a recurring price with interval for the paid branch", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 2000,
        currency: "usd",
        interval: "month",
      }),
    );
    expect(html).toBe("<span>$20.00/month</span>");
  });

  it("formats multi-count intervals as 'every N units'", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 20000,
        currency: "usd",
        interval: "month",
        intervalCount: 3,
      }),
    );
    expect(html).toContain("$200.00 every 3 months");
  });

  it("omits the interval for one_time prices", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 1500,
        currency: "usd",
        interval: "month",
        type: "one_time",
      }),
    );
    expect(html).toBe("<span>$15.00</span>");
  });

  it("applies className on the paid branch", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 999,
        currency: "usd",
        type: "one_time",
        className: "tag",
      }),
    );
    expect(html).toBe('<span class="tag">$9.99</span>');
  });

  it("invokes the children render-prop with freeLabel on the free branch", () => {
    let received: { formattedPrice: string } | undefined;
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 0,
        currency: "usd",
        freeLabel: "Gratis",
        children: (props) => {
          received = props;
          return createElement("em", null, props.formattedPrice);
        },
      }),
    );
    expect(received).toEqual({ formattedPrice: "Gratis" });
    expect(html).toBe("<em>Gratis</em>");
  });

  it("invokes the children render-prop with the formatted price on the paid branch", () => {
    let received: { formattedPrice: string } | undefined;
    const html = renderToStaticMarkup(
      createElement(PriceBadge, {
        unitAmount: 4999,
        currency: "usd",
        interval: "year",
        children: (props) => {
          received = props;
          return createElement("strong", null, props.formattedPrice);
        },
      }),
    );
    expect(received).toEqual({ formattedPrice: "$49.99/year" });
    expect(html).toBe("<strong>$49.99/year</strong>");
  });
});
