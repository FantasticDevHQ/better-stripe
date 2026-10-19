import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { productConfiguration } from "../../convex/meteredProducts/policy";
const state = vi.hoisted(() => ({
  enrollment: null as unknown,
  latest: null as string | null,
  work: "held",
  purchase: "pending",
  cancel: { status: "active", cancelAtPeriodEnd: true },
  calls: vi.fn(),
}));
vi.mock("convex/react", async (original) => ({
  ...(await original<typeof import("convex/react")>()),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith("funding:latest")
      ? state.latest
      : state.enrollment,
  useAction:
    (ref: Parameters<typeof getFunctionName>[0]) => async (args: object) => {
      const name = getFunctionName(ref);
      state.calls(name, args);
      if (name.endsWith("work:consume"))
        return JSON.stringify({ status: state.work, work: "completed_once" });
      if (name.endsWith("funding:purchase")) {
        state.latest = (args as { requestId: string }).requestId;
        return JSON.stringify({ state: state.purchase });
      }
      if (name.endsWith("native:checkout"))
        return JSON.stringify({ status: "open" });
      if (name.endsWith("native:cancelRenewal"))
        return JSON.stringify(state.cancel);
      if (name.endsWith("readers:preview"))
        return JSON.stringify({
          status: "available",
          value: {
            linesComplete: true,
            total: "3500",
            currency: "usd",
            meterAmount: { status: "available", value: { amount: "1500" } },
          },
        });
      return JSON.stringify({ status: "active" });
    },
}));
vi.mock("./metered-product-usage", () => ({
  ProductUsageViews: () => <div>Original product usage views</div>,
}));
import { MeteredEnrollment } from "./metered-product-enrollment";
function offer(prepaid = false) {
  const configuration = productConfiguration(
    prepaid ? "prepaid" : "included_overage",
    "Coaching",
  );
  return {
    _id: "offer",
    productName: prepaid ? "Store reports" : "Coaching",
    baseAmount: prepaid ? 0 : 2000,
    configurationJson: JSON.stringify(configuration),
    providerJson: JSON.stringify({
      configuration,
      price: { currency: "usd", active: true, plan: configuration.plan },
    }),
  } as Doc<"meteredProductOffers">;
}
function enroll(method = "charge_automatically") {
  state.enrollment = {
    _id: "enrollment",
    providerJson: JSON.stringify({
      status: "active",
      cancelAtPeriodEnd: false,
      collection: { method },
      bindings: [],
    }),
  };
}
function show(prepaid = false) {
  render(
    <MeteredEnrollment actorId={"buyer" as never} offer={offer(prepaid)} />,
  );
}
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  state.enrollment = null;
  state.latest = null;
  state.work = "held";
  state.purchase = "pending";
  state.cancel = { status: "active", cancelAtPeriodEnd: true };
  state.calls.mockClear();
});
it("creates original product Checkout without allowing the browser to submit prices, then refreshes the saved enrollment", async () => {
  show();
  await userEvent.click(
    screen.getByRole("button", { name: "Subscribe to this product" }),
  );
  expect(await screen.findByText(/Checkout is ready/)).toBeTruthy();
  expect(state.calls).toHaveBeenCalledWith("meteredProducts/native:checkout", {
    actorId: "buyer",
    offerId: "offer",
  });
  cleanup();
  state.enrollment = {
    _id: "enrollment",
    checkoutJson: JSON.stringify({
      status: "open",
      url: "https://checkout.stripe.com/original-test",
    }),
  };
  show();
  expect(
    screen
      .getByRole("link", { name: "Open Stripe Checkout" })
      .getAttribute("href"),
  ).toContain("original-test");
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh enrollment" }),
  );
  expect(await screen.findByText(/Subscription refreshed/)).toBeTruthy();
  expect(state.calls).toHaveBeenCalledWith("meteredProducts/native:refresh", {
    actorId: "buyer",
    enrollmentId: "enrollment",
  });
});
it("keeps held work identity and quantity across a reload, then clears the original request only after acceptance", async () => {
  enroll();
  show();
  await userEvent.click(
    screen.getByRole("button", { name: "Complete coaching session" }),
  );
  expect(
    await screen.findByText(/Work held until original credit backing/),
  ).toBeTruthy();
  const first = state.calls.mock.calls.find(([name]) =>
    name.endsWith("work:consume"),
  )![1];
  cleanup();
  show();
  expect(
    (screen.getByLabelText("Coaching minutes") as HTMLInputElement).disabled,
  ).toBe(true);
  state.work = "accepted";
  await userEvent.click(
    screen.getByRole("button", { name: "Retry original session" }),
  );
  expect(await screen.findByText(/Minutes recorded once/)).toBeTruthy();
  const work = state.calls.mock.calls.filter(([name]) =>
    name.endsWith("work:consume"),
  );
  expect(work[1][1]).toEqual(first);
  expect(first.quantity).toBe("15");
  expect(sessionStorage.getItem("metered-work:buyer:enrollment")).toBeNull();
});
it("retries a pending original credit purchase and never treats pending backing as ready", async () => {
  enroll("send_invoice");
  show(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Buy report credits with test card" }),
  );
  expect(
    await screen.findByText(/original credit purchase is pending/),
  ).toBeTruthy();
  const first = state.calls.mock.calls.find(([name]) =>
    name.endsWith("funding:purchase"),
  )![1];
  state.purchase = "ready";
  await userEvent.click(
    screen.getByRole("button", { name: "Retry original credit purchase" }),
  );
  expect(
    await screen.findByText(/Original credit payment verified/),
  ).toBeTruthy();
  const purchases = state.calls.mock.calls.filter(([name]) =>
    name.endsWith("funding:purchase"),
  );
  expect(purchases[1][1]).toEqual(first);
  state.work = "denied";
  await userEvent.click(
    screen.getByRole("button", { name: "Generate reports" }),
  );
  expect(
    await screen.findByText("Insufficient credits. No work performed."),
  ).toBeTruthy();
});
it("labels native invoice previews as estimates and reports cancellation only when fresh observation confirms it", async () => {
  enroll();
  show();
  await userEvent.click(
    screen.getByRole("button", { name: "Preview next invoice" }),
  );
  expect(
    await screen.findByText(
      /Draft next invoice: \$35.00 total; usage portion \$15.00/,
    ),
  ).toBeTruthy();
  state.cancel = { status: "active", cancelAtPeriodEnd: false };
  await userEvent.click(screen.getByRole("button", { name: "Cancel renewal" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText(/Renewal canceled. Service continues/)).toBeNull();
  state.cancel.cancelAtPeriodEnd = true;
  await userEvent.click(screen.getByRole("button", { name: "Cancel renewal" }));
  expect(
    await screen.findByText(/Renewal canceled. Service continues/),
  ).toBeTruthy();
});
it("retains unsupported earlier prepaid enrollment history without exposing work or credit purchase controls", () => {
  enroll();
  show(true);
  expect(
    screen.getByText(
      /earlier test enrollment uses unsupported automatic collection/,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Generate reports" })).toBeNull();
  expect(screen.getByText("Original product usage views")).toBeTruthy();
});
