import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EarningsSummary } from "./components/EarningsSummary.js";
it("lets currency-aware earnings consumers format three-decimal observed amounts", () => {
  const html = renderToStaticMarkup(
    createElement(EarningsSummary, {
      gross: 1234,
      reversed: 100,
      net: 1134,
      paidOut: 1000,
      currency: "kwd",
      payouts: [],
      formatAmount: (amount: number, currency: string) =>
        `${currency.toUpperCase()} ${(amount / 1000).toFixed(3)}`,
    }),
  );
  expect(html).toContain("KWD 1.234");
  expect(html).toContain("KWD 1.134");
});
