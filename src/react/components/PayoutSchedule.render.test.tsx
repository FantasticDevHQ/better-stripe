/**
 * Behavioral render tests for <PayoutSchedule> (BTS-38).
 *
 * PayoutSchedule is a pure, hook-free presentational component (the app feeds
 * it the recipient's balance and payout rows), so we render it to a static
 * HTML string with react-dom/server (no jsdom) and assert on the markup:
 *   - loading and empty states
 *   - available/pending balance amounts (formatted)
 *   - the next-payout line: templated amount+date from the earliest upcoming
 *     payout, falling back to the rolling-schedule message when there is no
 *     dated upcoming payout (payouts are automatic/rolling — no manual
 *     withdrawal surface)
 *   - the hosted-dashboard link (manageUrl), label overrides, className, and
 *     the render-prop escape hatch
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PayoutSchedule as BarrelExport } from "../index.js";
import {
  PayoutSchedule,
  type PayoutScheduleRenderProps,
} from "./PayoutSchedule.js";

const balance = { available: 12550, pending: 4300, currency: "usd" };

const payouts = [
  {
    _id: "p1",
    _creationTime: 1,
    stripePayoutId: "po_paid",
    accountId: "acct_1",
    amount: 9900,
    currency: "usd",
    status: "paid" as const,
    arrivalDate: "2026-06-19T00:00:00.000Z",
  },
  {
    _id: "p2",
    _creationTime: 2,
    stripePayoutId: "po_next",
    accountId: "acct_1",
    amount: 4000,
    currency: "usd",
    status: "in_transit" as const,
    arrivalDate: "2026-07-10T00:00:00.000Z",
  },
  {
    _id: "p3",
    _creationTime: 3,
    stripePayoutId: "po_later",
    accountId: "acct_1",
    amount: 1500,
    currency: "usd",
    status: "pending" as const,
    arrivalDate: "2026-07-17T00:00:00.000Z",
  },
];

describe("PayoutSchedule", () => {
  it("renders the loading label while balance/payout data is pending", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, { isLoading: true }),
    );
    expect(html).toContain("Loading payouts…");
    expect(html).toContain('role="status"');
  });

  it("renders the empty label when there is no balance and no payout history", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, { balance: null, payouts: [] }),
    );
    expect(html).toContain("No payouts yet");
  });

  it("renders available and pending balance amounts", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, { balance, payouts: [] }),
    );
    expect(html).toContain("Available");
    expect(html).toContain("$125.50");
    expect(html).toContain("Pending");
    expect(html).toContain("$43.00");
  });

  it("announces the earliest upcoming payout with amount and date", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, { balance, payouts }),
    );
    // po_next ($40, in_transit, Jul 10) beats po_later; the paid row is history.
    expect(html).toContain("Next payout of $40.00 expected Jul 10, 2026");
  });

  it("falls back to the rolling-schedule message when no upcoming payout is dated", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, {
        balance,
        payouts: [payouts[0]], // only the paid (historical) payout
      }),
    );
    expect(html).toContain(
      "Payouts run automatically on a rolling weekly schedule",
    );
  });

  it("renders the hosted-dashboard link when manageUrl is provided", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, {
        balance,
        payouts: [],
        manageUrl: "https://connect.stripe.com/express_login",
      }),
    );
    expect(html).toContain('href="https://connect.stripe.com/express_login"');
    expect(html).toContain("Manage payouts on Stripe");
  });

  it("omits the dashboard link without manageUrl", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, { balance, payouts: [] }),
    );
    expect(html).not.toContain("<a");
  });

  it("honours label overrides and {amount}/{date} templating", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, {
        balance,
        payouts,
        labels: { available: "Ready to pay out" },
        nextPayoutLabel: "{amount} arriving {date}",
      }),
    );
    expect(html).toContain("Ready to pay out");
    expect(html).toContain("$40.00 arriving Jul 10, 2026");
  });

  it("applies className to the root element", () => {
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, {
        balance,
        payouts: [],
        className: "payout-card",
      }),
    );
    expect(html).toContain('class="payout-card"');
  });

  it("invokes the children render-prop with the computed schedule props", () => {
    let received: PayoutScheduleRenderProps | undefined;
    const html = renderToStaticMarkup(
      createElement(PayoutSchedule, {
        balance,
        payouts,
        children: (props: PayoutScheduleRenderProps) => {
          received = props;
          return createElement("section", null, props.nextPayoutMessage);
        },
      }),
    );
    expect(received).toMatchObject({
      balance,
      availableLabel: "$125.50",
      pendingLabel: "$43.00",
      nextPayoutMessage: "Next payout of $40.00 expected Jul 10, 2026",
      payouts,
    });
    expect(received!.nextPayout).toMatchObject({ stripePayoutId: "po_next" });
    expect(html).toBe(
      "<section>Next payout of $40.00 expected Jul 10, 2026</section>",
    );
  });

  it("exports from the correct module via the react barrel", () => {
    expect(BarrelExport).toBe(PayoutSchedule);
  });
});
