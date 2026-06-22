/**
 * Behavioral render tests for <PriceCard>.
 *
 * PriceCard is a pure, hook-free presentational component, so we render it to a
 * static HTML string with react-dom/server (no jsdom required) and assert on the
 * markup for every branch:
 *   - optional productName heading
 *   - isCurrentPlan → renders the currentPlanLabel span and NO select button
 *   - not current plan → renders the select button (disabled iff isSelected)
 *   - aria-selected reflects isSelected
 *   - the render-prop `children` path → receives { price, formattedPrice,
 *     isSelected, isCurrentPlan } and its output replaces the default card
 * These assertions lock in the accessibility attributes and the
 * current-plan-vs-selectable affordance that drive the plan picker UX.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PriceCard, type PriceCardPrice } from "./PriceCard.js";

const basePrice: PriceCardPrice = {
  stripePriceId: "price_123",
  unitAmount: 2000,
  currency: "usd",
  type: "recurring",
  interval: "month",
  intervalCount: 1,
  active: true,
};

describe("PriceCard", () => {
  it("renders the formatted price inside the default card with role=option", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice }),
    );
    expect(html).toContain('role="option"');
    expect(html).toContain("<p>$20.00/month</p>");
  });

  it("renders the productName heading when provided", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice, productName: "Pro" }),
    );
    expect(html).toContain("<h3>Pro</h3>");
  });

  it("omits the heading when productName is absent", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice }),
    );
    expect(html).not.toContain("<h3>");
  });

  it("renders a Select button (enabled) when not selected and not current plan", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice }),
    );
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain("Select");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Current plan");
  });

  it("disables the button and sets aria-selected when isSelected is true", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice, isSelected: true }),
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("disabled");
  });

  it("renders the current-plan label and no button when isCurrentPlan is true", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice, isCurrentPlan: true }),
    );
    expect(html).toContain("<span>Current plan</span>");
    expect(html).not.toContain("<button");
  });

  it("honours custom i18n labels", () => {
    const currentHtml = renderToStaticMarkup(
      createElement(PriceCard, {
        price: basePrice,
        isCurrentPlan: true,
        currentPlanLabel: "Aktueller Plan",
      }),
    );
    expect(currentHtml).toContain("<span>Aktueller Plan</span>");

    const selectHtml = renderToStaticMarkup(
      createElement(PriceCard, {
        price: basePrice,
        selectLabel: "Auswählen",
      }),
    );
    expect(selectHtml).toContain("Auswählen");
  });

  it("applies className to the card container", () => {
    const html = renderToStaticMarkup(
      createElement(PriceCard, { price: basePrice, className: "card" }),
    );
    expect(html).toContain('class="card"');
  });

  it("invokes the children render-prop with the full context object", () => {
    let received:
      | {
          price: PriceCardPrice;
          formattedPrice: string;
          isSelected: boolean;
          isCurrentPlan: boolean;
        }
      | undefined;
    const html = renderToStaticMarkup(
      createElement(PriceCard, {
        price: basePrice,
        isSelected: true,
        isCurrentPlan: false,
        children: (props) => {
          received = props;
          return createElement("article", null, props.formattedPrice);
        },
      }),
    );
    expect(received).toEqual({
      price: basePrice,
      formattedPrice: "$20.00/month",
      isSelected: true,
      isCurrentPlan: false,
    });
    expect(html).toBe("<article>$20.00/month</article>");
  });
});
