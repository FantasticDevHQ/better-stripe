/**
 * Behavioral render tests for <TrialAlert>.
 *
 * TrialAlert is a pure, hook-free presentational component, so we render it to a
 * static HTML string with react-dom/server (no jsdom required) and assert on the
 * markup for every branch:
 *   - the early-return: not trialing AND no days remaining → renders nothing
 *   - trialing → uses trialLabel template with {days} substituted
 *   - not trialing but days remaining → uses renewalLabel template
 *   - {days} substitution for arbitrary daysRemaining values
 *   - the render-prop `children` path → receives { isTrialing, daysRemaining,
 *     message } and its output replaces the default role=alert div
 * These tests pin down the visibility rule and the message templating, which are
 * the only logic the component contains.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrialAlert } from "./TrialAlert.js";

describe("TrialAlert", () => {
  it("renders nothing when not trialing and no days remain", () => {
    const html = renderToStaticMarkup(
      createElement(TrialAlert, { isTrialing: false, daysRemaining: 0 }),
    );
    expect(html).toBe("");
  });

  it("renders nothing when not trialing and daysRemaining is negative", () => {
    const html = renderToStaticMarkup(
      createElement(TrialAlert, { isTrialing: false, daysRemaining: -3 }),
    );
    expect(html).toBe("");
  });

  it("renders the trial message with substituted days when trialing", () => {
    const html = renderToStaticMarkup(
      createElement(TrialAlert, { isTrialing: true, daysRemaining: 7 }),
    );
    expect(html).toBe('<div role="alert">Trial ends in 7 days</div>');
  });

  it("still renders while trialing even when daysRemaining is 0", () => {
    const html = renderToStaticMarkup(
      createElement(TrialAlert, { isTrialing: true, daysRemaining: 0 }),
    );
    expect(html).toContain("Trial ends in 0 days");
  });

  it("renders the renewal message when not trialing but days remain", () => {
    const html = renderToStaticMarkup(
      createElement(TrialAlert, { isTrialing: false, daysRemaining: 14 }),
    );
    expect(html).toBe('<div role="alert">Renews in 14 days</div>');
  });

  it("honours custom label templates and substitutes {days}", () => {
    const trialHtml = renderToStaticMarkup(
      createElement(TrialAlert, {
        isTrialing: true,
        daysRemaining: 3,
        trialLabel: "{days} day trial left",
      }),
    );
    expect(trialHtml).toContain("3 day trial left");

    const renewalHtml = renderToStaticMarkup(
      createElement(TrialAlert, {
        isTrialing: false,
        daysRemaining: 30,
        renewalLabel: "Renewal in {days}d",
      }),
    );
    expect(renewalHtml).toContain("Renewal in 30d");
  });

  it("applies className to the alert div", () => {
    const html = renderToStaticMarkup(
      createElement(TrialAlert, {
        isTrialing: true,
        daysRemaining: 5,
        className: "alert",
      }),
    );
    expect(html).toContain('class="alert"');
    expect(html).toContain('role="alert"');
  });

  it("invokes the children render-prop with the computed message (trialing)", () => {
    let received:
      | { isTrialing: boolean; daysRemaining: number; message: string }
      | undefined;
    const html = renderToStaticMarkup(
      createElement(TrialAlert, {
        isTrialing: true,
        daysRemaining: 2,
        children: (props) => {
          received = props;
          return createElement("p", null, props.message);
        },
      }),
    );
    expect(received).toEqual({
      isTrialing: true,
      daysRemaining: 2,
      message: "Trial ends in 2 days",
    });
    expect(html).toBe("<p>Trial ends in 2 days</p>");
  });

  it("invokes the children render-prop with the renewal message (not trialing)", () => {
    let received:
      | { isTrialing: boolean; daysRemaining: number; message: string }
      | undefined;
    renderToStaticMarkup(
      createElement(TrialAlert, {
        isTrialing: false,
        daysRemaining: 9,
        children: (props) => {
          received = props;
          return createElement("p", null, props.message);
        },
      }),
    );
    expect(received).toEqual({
      isTrialing: false,
      daysRemaining: 9,
      message: "Renews in 9 days",
    });
  });
});
