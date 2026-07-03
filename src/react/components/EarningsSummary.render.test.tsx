/**
 * Behavioral render tests for <EarningsSummary> (BTS-37).
 *
 * EarningsSummary is a pure, hook-free presentational component shaped to be
 * spread straight from `useEarnings(accountId)` (BTS-36), so we render it to a
 * static HTML string with react-dom/server (no jsdom) and assert on:
 *   - loading / empty states
 *   - gross / reversals / net / paid-out amounts (formatted); per the BTS-36
 *     review the reversals figure is labeled "Reversals & adjustments" (it
 *     sums fee collection AND clawbacks), NOT "fees"
 *   - the latest-payout status line, incl. the no-payouts fallback
 *   - label overrides, className, and the render-prop escape hatch
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EarningsSummary as BarrelExport } from "../index.js";
import {
  EarningsSummary,
  type EarningsSummaryRenderProps,
} from "./EarningsSummary.js";

const payouts = [
  {
    _id: "p1",
    _creationTime: 100,
    stripePayoutId: "po_old",
    accountId: "acct_1",
    amount: 3000,
    currency: "usd",
    status: "paid" as const,
  },
  {
    _id: "p2",
    _creationTime: 200,
    stripePayoutId: "po_latest",
    accountId: "acct_1",
    amount: 4000,
    currency: "usd",
    status: "in_transit" as const,
  },
];

const earnings = {
  gross: 10500,
  reversed: 1000,
  net: 9500,
  payouts,
  paidOut: 3000,
};

describe("EarningsSummary", () => {
  it("renders the loading label while earnings are pending", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, { ...earnings, isLoading: true }),
    );
    expect(html).toContain("Loading earnings…");
    expect(html).toContain('role="status"');
  });

  it("renders the empty label when there are no earnings at all", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, {
        gross: 0,
        reversed: 0,
        net: 0,
        payouts: [],
        paidOut: 0,
      }),
    );
    expect(html).toContain("No earnings yet");
  });

  it("renders gross, reversals, net, and paid-out amounts", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, earnings),
    );
    expect(html).toContain("Gross");
    expect(html).toContain("$105.00");
    // Honest label per the BTS-36 review — NOT "Fees".
    expect(html).toContain("Reversals &amp; adjustments");
    expect(html).not.toContain("Fees");
    expect(html).toContain("$10.00");
    expect(html).toContain("Net");
    expect(html).toContain("$95.00");
    expect(html).toContain("Paid out");
    expect(html).toContain("$30.00");
  });

  it("announces the latest payout with amount and status", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, earnings),
    );
    // po_latest (newest _creationTime) wins over po_old.
    expect(html).toContain("Latest payout of $40.00 — in_transit");
  });

  it("falls back to the no-payouts message when there is no payout history", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, { ...earnings, payouts: [], paidOut: 0 }),
    );
    expect(html).toContain("No payouts yet");
  });

  it("honours label overrides and {amount}/{status} templating", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, {
        ...earnings,
        labels: { reversed: "Adjustments" },
        latestPayoutLabel: "{amount} is {status}",
      }),
    );
    expect(html).toContain("Adjustments");
    expect(html).toContain("$40.00 is in_transit");
  });

  it("applies className to the root element", () => {
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, { ...earnings, className: "earnings" }),
    );
    expect(html).toContain('class="earnings"');
  });

  it("invokes the children render-prop with the computed summary", () => {
    let received: EarningsSummaryRenderProps | undefined;
    const html = renderToStaticMarkup(
      createElement(EarningsSummary, {
        ...earnings,
        children: (props: EarningsSummaryRenderProps) => {
          received = props;
          return createElement("p", null, props.netLabel);
        },
      }),
    );
    expect(received).toMatchObject({
      grossLabel: "$105.00",
      reversedLabel: "$10.00",
      netLabel: "$95.00",
      paidOutLabel: "$30.00",
      latestPayoutMessage: "Latest payout of $40.00 — in_transit",
      payouts,
    });
    expect(received!.latestPayout).toMatchObject({
      stripePayoutId: "po_latest",
    });
    expect(html).toBe("<p>$95.00</p>");
  });

  it("exports from the correct module via the react barrel", () => {
    expect(BarrelExport).toBe(EarningsSummary);
  });
});
