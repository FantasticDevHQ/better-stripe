import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SellerPlan } from "../pages/seller/plan";
const calls = vi.hoisted(() => ({
  seller: "seller",
  prepare: vi.fn(),
  manage: vi.fn(),
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({ currentUser: { id: calls.seller } }),
}));
vi.mock("@/components/store-payment-source", () => ({
  StorePaymentSource: () => null,
}));
vi.mock("@/components/store-invoice-estimate", () => ({
  StoreInvoiceEstimate: () => null,
}));
vi.mock("convex/react", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return name.endsWith(":prepareManage")
      ? calls.prepare
      : name.endsWith(":manage")
        ? calls.manage
        : vi.fn();
  },
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name.endsWith(":getState"))
      return {
        hasAccess: true,
        stripeAccountId: "acct_seller",
        storePlan: {
          planId: "starter",
          stripeSubscriptionId: "sub_saved",
          status: "active",
          paidThrough: Date.now() + 86400000,
          cancelAtPeriodEnd: false,
        },
      };
    if (name.endsWith(":getPublishableKey")) return "pk_test_fixture";
    return [
      {
        id: "growth",
        name: "Growth",
        monthlyAmount: 2000,
        effectiveBasisPoints: 0,
        feeLabel: "9%",
      },
    ];
  },
}));
beforeEach(() => {
  calls.seller = "seller";
  sessionStorage.clear();
  vi.resetAllMocks();
  calls.prepare.mockImplementation(async ({ key }) => ({
    key,
    binding: "server normalized request",
  }));
  calls.manage.mockRejectedValue(new Error("Unknown provider outcome"));
});
afterEach(cleanup);
function mount() {
  return render(
    <MemoryRouter>
      <SellerPlan />
    </MemoryRouter>,
  );
}
it("reuses the saved identity after an unknown outcome and remount until an explicit new request", async () => {
  const first = mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Review change to Growth" }),
  );
  await screen.findByText("Unknown provider outcome");
  const identity = calls.manage.mock.calls[0]![0].requestIdentity;
  expect(identity).toEqual({
    key: expect.stringMatching(/^portal:/),
    binding: "server normalized request",
  });
  first.unmount();
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Review change to Growth" }),
  );
  await screen.findByText("Unknown provider outcome");
  expect(calls.manage.mock.calls[1]![0].requestIdentity).toEqual(identity);
  expect(calls.prepare).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: "Start a new billing request" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review change to Growth" }),
  );
  await waitFor(() => expect(calls.manage).toHaveBeenCalledTimes(3));
  expect(calls.manage.mock.calls[2]![0].requestIdentity.key).not.toBe(
    identity.key,
  );
});
it("does not POST from a preparation that finishes after unmount", async () => {
  let resolve!: (value: { key: string; binding: string }) => void;
  calls.prepare.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const first = mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Review change to Growth" }),
  );
  await waitFor(() => expect(calls.prepare).toHaveBeenCalledOnce());
  expect(
    screen.getByRole("button", { name: "Manage plan, billing & cancellation" }),
  ).toBeDisabled();
  first.unmount();
  resolve({
    key: calls.prepare.mock.calls[0]![0].key,
    binding: "server normalized request",
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(calls.manage).not.toHaveBeenCalled();
});

it("does not POST for an old actor when preparation finishes after a scope change", async () => {
  let resolve!: (value: { key: string; binding: string }) => void;
  calls.prepare.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Review change to Growth" }),
  );
  await waitFor(() => expect(calls.prepare).toHaveBeenCalledOnce());
  calls.seller = "other-seller";
  view.rerender(
    <MemoryRouter>
      <SellerPlan />
    </MemoryRouter>,
  );
  resolve({
    key: calls.prepare.mock.calls[0]![0].key,
    binding: "old actor request",
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Review change to Growth" }),
    ).toBeEnabled(),
  );
  expect(calls.manage).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review change to Growth" }),
  );
  await screen.findByText("Unknown provider outcome");
  expect(calls.manage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sellerId: "other-seller" }),
  );
});
