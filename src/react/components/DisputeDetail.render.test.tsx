/**
 * Behavioral render tests for <DisputeDetail> (BTS-54).
 *
 * DisputeDetail is a pure, hook-free presentational component consuming the
 * `DisputeWithCountdown` shape returned by `useDisputeWithCountdown`, so we
 * render it to a static HTML string with react-dom/server (no jsdom) and
 * assert on the markup for every branch:
 *   - loading → loadingLabel
 *   - resolved-but-missing dispute → emptyLabel
 *   - full detail: formatted amount, reason, status, due-by countdown message,
 *     and the linkedTransferIds list
 *   - countdown branches: due in N days / overdue / no deadline
 *   - label templating ({days}) and i18n overrides
 *   - className and the render-prop `children` escape hatch
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DisputeDetail as BarrelExport } from "../index.js";
import type { DisputeWithCountdown } from "../hooks/useDisputeWithCountdown.js";
import {
  DisputeDetail,
  type DisputeDetailRenderProps,
} from "./DisputeDetail.js";

const dispute: DisputeWithCountdown = {
  _id: "doc1",
  _creationTime: 0,
  stripeDisputeId: "dp_1",
  amount: 12050,
  currency: "usd",
  status: "needs_response",
  reason: "fraudulent",
  isChargeRefundable: true,
  evidenceDueBy: "2026-07-10T00:00:00.000Z",
  linkedTransferIds: ["tr_store_1", "tr_affiliate_1"],
  countdown: {
    dueBy: "2026-07-10T00:00:00.000Z",
    daysRemaining: 5,
    isOverdue: false,
  },
};

describe("DisputeDetail", () => {
  it("renders the loading label while the dispute query is pending", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, { dispute: undefined, isLoading: true }),
    );
    expect(html).toContain("Loading dispute…");
  });

  it("renders the empty label when the dispute is not found", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, { dispute: null }),
    );
    expect(html).toContain("Dispute not found");
  });

  it("renders amount, reason, status, countdown, and linked transfer ids", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, { dispute }),
    );
    expect(html).toContain("$120.50");
    expect(html).toContain("fraudulent");
    expect(html).toContain("needs_response");
    expect(html).toContain("Evidence due in 5 days");
    expect(html).toContain("tr_store_1");
    expect(html).toContain("tr_affiliate_1");
  });

  it("renders the overdue message when the countdown is overdue", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, {
        dispute: {
          ...dispute,
          countdown: { dueBy: dispute.evidenceDueBy, daysRemaining: -2, isOverdue: true },
        },
      }),
    );
    expect(html).toContain("Evidence overdue");
    expect(html).not.toContain("Evidence due in");
  });

  it("renders the no-deadline message when there is no due date", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, {
        dispute: { ...dispute, countdown: { isOverdue: false } },
      }),
    );
    expect(html).toContain("No evidence deadline");
  });

  it("omits the linked-transfers list when there are no linked transfers", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, {
        dispute: { ...dispute, linkedTransferIds: undefined },
      }),
    );
    expect(html).not.toContain("<ul");
  });

  it("honours label overrides and substitutes {days} in the due template", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, {
        dispute,
        dueLabel: "{days}d left to respond",
      }),
    );
    expect(html).toContain("5d left to respond");
  });

  it("applies className to the root element", () => {
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, { dispute, className: "dispute-detail" }),
    );
    expect(html).toContain('class="dispute-detail"');
  });

  it("invokes the children render-prop with the computed detail props", () => {
    let received: DisputeDetailRenderProps | undefined;
    const html = renderToStaticMarkup(
      createElement(DisputeDetail, {
        dispute,
        children: (props: DisputeDetailRenderProps) => {
          received = props;
          return createElement("section", null, props.amountLabel);
        },
      }),
    );
    expect(received).toMatchObject({
      dispute,
      amountLabel: "$120.50",
      countdownMessage: "Evidence due in 5 days",
      linkedTransferIds: ["tr_store_1", "tr_affiliate_1"],
    });
    expect(html).toBe("<section>$120.50</section>");
  });

  it("exports from the correct module via the react barrel", () => {
    expect(BarrelExport).toBe(DisputeDetail);
  });
});
