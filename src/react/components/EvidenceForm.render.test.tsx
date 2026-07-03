/**
 * Behavioral render tests for <EvidenceForm> (BTS-54).
 *
 * EvidenceForm is a headless controlled form for the four Skool-style dispute
 * evidence fields. The impure half (`updateDispute`) is injected as the
 * `onUpdateDispute` callback, so with react-dom/server we can:
 *   - assert the default markup renders the four labeled fields + both actions
 *   - capture the render-prop closures and drive `stage()` / `submit()`
 *     directly, asserting the callback receives `buildDisputeEvidence`-mapped
 *     evidence, the account scoping, and `submit: true` ONLY on submit
 *   - assert the error path surfaces a rejected callback via `onError`
 * No jsdom/RTL — state-transition re-renders (isProcessing flips) are out of
 * scope by project test strategy; the branch logic lives in the closures.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EvidenceForm as BarrelExport } from "../index.js";
import {
  EvidenceForm,
  type EvidenceFormRenderProps,
} from "./EvidenceForm.js";

const allFields = {
  productDescription: "Ceramics Masterclass, lifetime access",
  accessActivity: "Logged in 14 times, watched 9 lessons",
  additionalInfo: "Buyer left a 5-star review before disputing",
  customerCommunication: "Support thread transcript attached",
};

/** Render via the children prop and hand back the captured render props. */
function capture(
  props: Omit<
    Parameters<typeof EvidenceForm>[0],
    "children"
  >,
): EvidenceFormRenderProps {
  let received: EvidenceFormRenderProps | undefined;
  renderToStaticMarkup(
    createElement(EvidenceForm, {
      ...props,
      children: (rp: EvidenceFormRenderProps) => {
        received = rp;
        return null;
      },
    }),
  );
  if (!received) throw new Error("children render-prop was not invoked");
  return received;
}

describe("EvidenceForm", () => {
  it("renders the four evidence fields and both action buttons by default", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceForm, {
        stripeDisputeId: "dp_1",
        onUpdateDispute: vi.fn(),
      }),
    );
    expect(html).toContain("Product description");
    expect(html).toContain("Access activity");
    expect(html).toContain("Additional information");
    expect(html).toContain("Customer communication");
    expect((html.match(/<textarea/g) ?? []).length).toBe(4);
    expect(html).toContain("Save draft");
    expect(html).toContain("Submit evidence");
  });

  it("stage() maps the fields through buildDisputeEvidence and omits submit", async () => {
    const onUpdateDispute = vi.fn().mockResolvedValue({ success: true });
    const rp = capture({
      stripeDisputeId: "dp_1",
      onUpdateDispute,
      initialFields: allFields,
    });

    await rp.stage();

    expect(onUpdateDispute).toHaveBeenCalledTimes(1);
    const args = onUpdateDispute.mock.calls[0][0];
    expect(args.stripeDisputeId).toBe("dp_1");
    expect(args.evidence).toEqual({
      product_description: allFields.productDescription,
      access_activity_log: allFields.accessActivity,
      uncategorized_text: allFields.additionalInfo,
      customer_communication: allFields.customerCommunication,
    });
    expect("submit" in args).toBe(false);
  });

  it("submit() passes submit: true alongside the mapped evidence", async () => {
    const onUpdateDispute = vi.fn().mockResolvedValue({ success: true });
    const rp = capture({
      stripeDisputeId: "dp_1",
      onUpdateDispute,
      initialFields: allFields,
    });

    await rp.submit();

    expect(onUpdateDispute).toHaveBeenCalledTimes(1);
    expect(onUpdateDispute.mock.calls[0][0]).toMatchObject({
      stripeDisputeId: "dp_1",
      submit: true,
    });
  });

  it("omits empty fields from the built evidence", async () => {
    const onUpdateDispute = vi.fn().mockResolvedValue({ success: true });
    const rp = capture({
      stripeDisputeId: "dp_1",
      onUpdateDispute,
      initialFields: { productDescription: "Just the description" },
    });

    await rp.stage();

    expect(onUpdateDispute.mock.calls[0][0].evidence).toEqual({
      product_description: "Just the description",
    });
  });

  it("forwards stripeAccountId so the update is seller-account scoped", async () => {
    const onUpdateDispute = vi.fn().mockResolvedValue({ success: true });
    const rp = capture({
      stripeDisputeId: "dp_1",
      stripeAccountId: "acct_seller",
      onUpdateDispute,
      initialFields: allFields,
    });

    await rp.submit();

    expect(onUpdateDispute.mock.calls[0][0]).toMatchObject({
      stripeAccountId: "acct_seller",
    });
  });

  it("fires onStaged after a successful stage and onSubmitted after submit", async () => {
    const onStaged = vi.fn();
    const onSubmitted = vi.fn();
    const rp = capture({
      stripeDisputeId: "dp_1",
      onUpdateDispute: vi.fn().mockResolvedValue({ success: true }),
      onStaged,
      onSubmitted,
    });

    await rp.stage();
    expect(onStaged).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();

    await rp.submit();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onStaged).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected update via onError instead of throwing", async () => {
    const onError = vi.fn();
    const rp = capture({
      stripeDisputeId: "dp_1",
      onUpdateDispute: vi.fn().mockRejectedValue(new Error("stripe said no")),
      onError,
    });

    await expect(rp.stage()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith("stripe said no");
  });

  it("exposes the current fields and labels to the render-prop", () => {
    const rp = capture({
      stripeDisputeId: "dp_1",
      onUpdateDispute: vi.fn(),
      initialFields: { accessActivity: "seed" },
      stageLabel: "Stash it",
      submitLabel: "Send it",
    });

    expect(rp.fields).toEqual({
      productDescription: "",
      accessActivity: "seed",
      additionalInfo: "",
      customerCommunication: "",
    });
    expect(rp.stageLabel).toBe("Stash it");
    expect(rp.submitLabel).toBe("Send it");
    expect(typeof rp.setField).toBe("function");
    expect(rp.isProcessing).toBe(false);
    expect(rp.error).toBeNull();
  });

  it("applies className and honours field label overrides in the default DOM", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceForm, {
        stripeDisputeId: "dp_1",
        onUpdateDispute: vi.fn(),
        className: "evidence-form",
        fieldLabels: { additionalInfo: "Anything else?" },
      }),
    );
    expect(html).toContain('class="evidence-form"');
    expect(html).toContain("Anything else?");
    expect(html).not.toContain("Additional information");
  });

  it("exports from the correct module via the react barrel", () => {
    expect(BarrelExport).toBe(EvidenceForm);
  });
});
