import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import { updateDispute, uploadDisputeEvidence } from "./disputes.js";

function makeStripe() {
  return {
    disputes: {
      update: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue({}),
    },
  };
}
const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof updateDispute>[0];

const TO_REF = Symbol.for("toReferencePath");

/**
 * Component proxy exposing the two connect query refs the dispute-action
 * authorization resolves: the dispute (by its Stripe id) and the payment that
 * dispute is linked to (by PaymentIntent id).
 */
function makeAuthComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    connect: {
      queries: {
        getDisputeByStripeId: ref("connect/queries/getDisputeByStripeId"),
        getPaymentByStripeId: ref("connect/queries/getPaymentByStripeId"),
      },
    },
  } as unknown as Component;
}

/**
 * A ctx whose runQuery dispatches by the query args: a `stripeDisputeId` lookup
 * resolves the dispute row; a `stripePaymentIntentId` lookup resolves the
 * payment row. Either may be null to exercise the fail-closed paths.
 */
function makeAuthCtx(disputeRow?: unknown, paymentRow?: unknown) {
  const runQuery = vi.fn().mockImplementation((_ref, args) => {
    if (args && "stripeDisputeId" in args)
      return Promise.resolve(disputeRow ?? null);
    if (args && "stripePaymentIntentId" in args)
      return Promise.resolve(paymentRow ?? null);
    return Promise.resolve(null);
  });
  return { runQuery } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
  };
}

describe("uploadDisputeEvidence", () => {
  const file = {
    data: new TextEncoder().encode("%PDF-1.7\nfixture"),
    name: "evidence.pdf",
    type: "application/pdf" as const,
  };
  const opts = {
    stripeDisputeId: "dp_1",
    actor: { type: "seller" as const, accountId: "acct_owner" },
    field: "customer_communication" as const,
    file,
  };
  function setup(owner = "acct_owner") {
    const stripe = {
      ...makeStripe(),
      files: { create: vi.fn().mockResolvedValue({ id: "file_uploaded" }) },
    };
    const ctx = makeAuthCtx(
      { stripePaymentIntentId: "pi_1" },
      { destinationAccountId: owner },
    );
    return { stripe, ctx };
  }
  it("uploads bytes and binds only the returned file ID as draft", async () => {
    const { stripe, ctx } = setup();
    const result = await uploadDisputeEvidence(
      asStripe(stripe),
      makeAuthComponent(),
      ctx,
      opts,
    );
    expect(stripe.files.create).toHaveBeenCalledWith(
      { purpose: "dispute_evidence", file },
      undefined,
    );
    expect(stripe.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      { evidence: { customer_communication: "file_uploaded" }, submit: false },
      undefined,
    );
    expect(result).toEqual({
      stripeFileId: "file_uploaded",
      stripeDisputeId: "dp_1",
    });
  });
  it("denies another seller before uploading", async () => {
    const { stripe, ctx } = setup("acct_other");
    await expect(
      uploadDisputeEvidence(asStripe(stripe), makeAuthComponent(), ctx, opts),
    ).rejects.toThrow(/not authorized/);
    expect(stripe.files.create).not.toHaveBeenCalled();
    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });
  it.each([
    { ...file, type: "text/plain" },
    { ...file, data: new Uint8Array(0) },
    { ...file, data: new Uint8Array(5_000_001) },
    { ...file, data: new TextEncoder().encode("not a PDF") },
  ])("rejects invalid files before provider calls", async (file) => {
    const { stripe, ctx } = setup();
    await expect(
      uploadDisputeEvidence(asStripe(stripe), makeAuthComponent(), ctx, {
        ...opts,
        file: file as typeof opts.file,
      }),
    ).rejects.toThrow(/Invalid dispute evidence/);
    expect(stripe.files.create).not.toHaveBeenCalled();
  });
  it("does not attach after an upload failure and preserves provider errors", async () => {
    const { stripe, ctx } = setup();
    stripe.files.create.mockRejectedValue({
      type: "StripeInvalidRequestError",
      code: "file_invalid",
      message: "Corrupt PDF",
    });
    await expect(
      uploadDisputeEvidence(asStripe(stripe), makeAuthComponent(), ctx, opts),
    ).rejects.toMatchObject({
      data: {
        code: "DISPUTE_UPLOAD_FAILED",
        stripeError: { code: "file_invalid" },
      },
    });
    expect(stripe.disputes.update).not.toHaveBeenCalled();
  });
  it("surfaces draft attachment failure without submitting", async () => {
    const { stripe, ctx } = setup();
    stripe.disputes.update.mockRejectedValue(new Error("unavailable"));
    await expect(
      uploadDisputeEvidence(asStripe(stripe), makeAuthComponent(), ctx, opts),
    ).rejects.toMatchObject({ data: { code: "DISPUTE_UPDATE_FAILED" } });
    expect(stripe.disputes.update.mock.calls[0][1].submit).toBe(false);
  });
});

it.each([
  {
    type: "image/png" as const,
    data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  },
  { type: "image/jpeg" as const, data: new Uint8Array([255, 216, 255]) },
])(
  "uploads supported image signatures to the owning request account",
  async (file) => {
    const stripe = {
      ...makeStripe(),
      files: { create: vi.fn().mockResolvedValue({ id: "file_image" }) },
    };
    await uploadDisputeEvidence(
      asStripe(stripe),
      makeAuthComponent(),
      {} as RunCtx,
      {
        actor: { type: "admin" },
        stripeDisputeId: "dp_1",
        stripeAccountId: "acct_direct",
        field: "receipt",
        file: { ...file, name: "proof" },
      },
    );
    expect(stripe.files.create.mock.calls[0][1]).toEqual({
      stripeAccount: "acct_direct",
    });
    expect(stripe.disputes.update.mock.calls[0][2]).toEqual({
      stripeAccount: "acct_direct",
    });
  },
);

it("rejects a malformed seller actor before any provider call", async () => {
  const stripe = {
    ...makeStripe(),
    files: { create: vi.fn().mockResolvedValue({ id: "file_1" }) },
  };
  await expect(
    uploadDisputeEvidence(
      asStripe(stripe),
      makeAuthComponent(),
      makeAuthCtx({ stripePaymentIntentId: "pi_1" }, {}),
      {
        actor: { type: "seller" } as Parameters<
          typeof uploadDisputeEvidence
        >[3]["actor"],
        stripeDisputeId: "dp_1",
        field: "receipt",
        file: {
          data: new TextEncoder().encode("%PDF-1.7"),
          name: "a.pdf",
          type: "application/pdf",
        },
      },
    ),
  ).rejects.toThrow(/authenticated actor/);
  expect(stripe.files.create).not.toHaveBeenCalled();
});
