/**
 * Behavioral render tests for <DisputesList> (BTS-40).
 *
 * DisputesList is a pure, hook-free presentational component, so we render it
 * to a static HTML string with react-dom/server (no jsdom required) and assert
 * on the markup for every branch:
 *   - empty state (default and custom label)
 *   - rows sorted by evidence deadline, soonest first, no-deadline last
 *   - each row shows the dispute status
 *   - countdown badge: due-in-days, overdue, and hidden when no deadline
 *   - headless overrides: className, per-row render prop, whole-list children
 * The countdown data is the exact shape produced by getDisputeWithCountdown /
 * useDisputeWithCountdown — the component renders it, never recomputes it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DisputeEvidenceCountdown } from "../hooks/useDisputeWithCountdown.js";
import { DisputesList, type DisputesListRow } from "./DisputesList.js";

let disputeSeq = 0;
function makeDispute(
  overrides: Partial<DisputesListRow> & {
    countdown?: DisputeEvidenceCountdown;
  } = {},
): DisputesListRow {
  disputeSeq += 1;
  return {
    _id: `doc_${disputeSeq}`,
    _creationTime: 0,
    stripeDisputeId: `dp_${disputeSeq}`,
    accountId: "acct_seller",
    amount: 2000,
    currency: "usd",
    status: "needs_response",
    reason: "fraudulent",
    isChargeRefundable: true,
    ...overrides,
  };
}

describe("DisputesList", () => {
  it("renders the default empty state when there are no disputes", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, { disputes: [] }),
    );
    expect(html).toContain("No disputes");
    expect(html).not.toContain("<li");
  });

  it("renders a custom emptyLabel", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [],
        emptyLabel: "Keine Streitfälle",
      }),
    );
    expect(html).toContain("Keine Streitfälle");
  });

  it("renders one row per dispute with its status", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [
          makeDispute({ stripeDisputeId: "dp_a", status: "needs_response" }),
          makeDispute({ stripeDisputeId: "dp_b", status: "under_review" }),
        ],
      }),
    );
    expect(html).toContain('role="list"');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain("needs_response");
    expect(html).toContain("under_review");
  });

  it("sorts rows by evidence deadline, soonest first, no-deadline last", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [
          makeDispute({
            stripeDisputeId: "dp_late",
            countdown: {
              dueBy: "2026-08-01T00:00:00.000Z",
              daysRemaining: 29,
              isOverdue: false,
            },
          }),
          makeDispute({ stripeDisputeId: "dp_none", countdown: undefined }),
          makeDispute({
            stripeDisputeId: "dp_soon",
            countdown: {
              dueBy: "2026-07-05T00:00:00.000Z",
              daysRemaining: 2,
              isOverdue: false,
            },
          }),
        ],
      }),
    );
    const order = ["dp_soon", "dp_late", "dp_none"].map((id) =>
      html.indexOf(id),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("renders a due-by countdown badge from the countdown data", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [
          makeDispute({
            countdown: {
              dueBy: "2026-07-10T00:00:00.000Z",
              daysRemaining: 7,
              isOverdue: false,
            },
          }),
        ],
      }),
    );
    expect(html).toContain("Evidence due in 7 days");
  });

  it("renders the overdue badge when the countdown is overdue", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [
          makeDispute({
            countdown: {
              dueBy: "2026-06-01T00:00:00.000Z",
              daysRemaining: -32,
              isOverdue: true,
            },
          }),
        ],
      }),
    );
    expect(html).toContain("Evidence overdue");
    expect(html).not.toContain("Evidence due in");
  });

  it("renders no countdown badge when a row has no deadline", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [makeDispute({ countdown: undefined })],
      }),
    );
    expect(html).not.toContain("Evidence due in");
    expect(html).not.toContain("Evidence overdue");
  });

  it("honours custom i18n labels with the {days} placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [
          makeDispute({
            countdown: {
              dueBy: "2026-07-10T00:00:00.000Z",
              daysRemaining: 7,
              isOverdue: false,
            },
          }),
          makeDispute({
            countdown: {
              dueBy: "2026-06-01T00:00:00.000Z",
              daysRemaining: -32,
              isOverdue: true,
            },
          }),
        ],
        dueLabel: "Noch {days} Tage",
        overdueLabel: "Überfällig",
      }),
    );
    expect(html).toContain("Noch 7 Tage");
    expect(html).toContain("Überfällig");
  });

  it("applies className to the list container", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [makeDispute()],
        className: "disputes",
      }),
    );
    expect(html).toContain('class="disputes"');
  });

  it("renders rows through the renderRow slot override, in sorted order", () => {
    const seen: string[] = [];
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [
          makeDispute({ stripeDisputeId: "dp_none", countdown: undefined }),
          makeDispute({
            stripeDisputeId: "dp_soon",
            countdown: {
              dueBy: "2026-07-05T00:00:00.000Z",
              daysRemaining: 2,
              isOverdue: false,
            },
          }),
        ],
        renderRow: (row) => {
          seen.push(row.dispute.stripeDisputeId);
          return createElement(
            "article",
            { key: row.dispute.stripeDisputeId },
            `${row.dispute.stripeDisputeId}:${row.badgeText ?? "none"}`,
          );
        },
      }),
    );
    expect(seen).toEqual(["dp_soon", "dp_none"]);
    expect(html).toContain("dp_soon:Evidence due in 2 days");
    expect(html).toContain("dp_none:none");
    // The slot replaces the default row markup entirely.
    expect(html).not.toContain("<li");
  });

  it("replaces the whole list with the children render prop", () => {
    let receivedCount: number | undefined;
    const html = renderToStaticMarkup(
      createElement(DisputesList, {
        disputes: [makeDispute(), makeDispute()],
        children: ({ disputes }) => {
          receivedCount = disputes.length;
          return createElement("section", null, `count:${disputes.length}`);
        },
      }),
    );
    expect(receivedCount).toBe(2);
    expect(html).toBe("<section>count:2</section>");
  });

  it("renders the loading state when isLoading and no data yet", () => {
    const html = renderToStaticMarkup(
      createElement(DisputesList, { disputes: undefined, isLoading: true }),
    );
    expect(html).toContain("Loading disputes");
    expect(html).not.toContain("No disputes");
  });
});
