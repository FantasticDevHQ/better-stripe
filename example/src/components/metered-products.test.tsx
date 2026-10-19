import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "seller",
  enabled: true,
  offers: [] as unknown[],
  execute: vi.fn(
    async (args: {
      actorId: string;
      configurationJson?: string;
      productId?: string;
      baseAmount?: number;
      sellerId?: string;
      enabled?: boolean;
    }) => {
      void args;
      return "offer-id";
    },
  ),
}));
vi.mock("convex/react", async (original) => ({
  ...(await original<typeof import("convex/react")>()),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name.endsWith("catalog:enabled")) return state.enabled;
    if (name.endsWith("catalog:products"))
      return {
        products: [{ id: "prod_coaching", name: "Coaching membership" }],
        cursor: "",
        done: true,
      };
    if (name.endsWith("catalog:list")) return state.offers;
    if (name.endsWith("catalog:stores"))
      return [
        { id: "maya", name: "Maya's Fitness", enabled: true },
        { id: "sasha", name: "Sasha Ceramics", enabled: false },
      ];
    return null;
  },
  useAction: () => state.execute,
  useMutation: () => state.execute,
}));
vi.mock("@/providers/role-context", () => ({
  useRole: () => ({
    currentUser: { id: "maya", name: "Maya's Fitness", role: state.role },
    currentRole: state.role,
  }),
}));
import { MeteredProducts } from "./metered-products";
function show(entry = "/") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <MeteredProducts />
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  state.role = "seller";
  state.enabled = true;
  state.offers = [];
  state.execute.mockClear();
});
it("attaches $20 plus 60 included coaching minutes to the selected product in both integration views", async () => {
  show();
  expect(screen.getByRole("tab", { name: /via API/i })).toBeTruthy();
  expect(
    screen.getByRole("tab", { name: "BetterStripe components" }),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("Monthly base price (USD)") as HTMLInputElement)
      .value,
  ).toBe("20.00");
  expect(
    (
      screen.getByLabelText(
        "Included units per billing period",
      ) as HTMLInputElement
    ).value,
  ).toBe("60");
  await userEvent.click(
    screen.getByRole("tab", { name: "BetterStripe components" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Attach billing to product" }),
  );
  expect(state.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      actorId: "maya",
      productId: "prod_coaching",
      baseAmount: 2000,
    }),
  );
  const payload = JSON.parse(state.execute.mock.calls[0][0].configurationJson!);
  expect(payload.plan).toMatchObject({
    model: "included_overage",
    includedQuantity: "60",
    unit: { name: "minute" },
  });
  expect(screen.queryByText(/sandbox issuer/i)).toBeNull();
});
it("explains disabled seller capability and does not offer a forged enable control", () => {
  state.enabled = false;
  show();
  expect(
    screen.getByText(/Metered billing is disabled for this store/),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Attach billing to product" }),
  ).toBeNull();
});
it("lets an admin enable Sasha's store independently from platform product configuration", async () => {
  state.role = "admin";
  show();
  await userEvent.click(
    screen.getByRole("switch", { name: "Metered billing for Sasha Ceramics" }),
  );
  expect(state.execute).toHaveBeenCalledWith({
    actorId: "maya",
    sellerId: "sasha",
    enabled: true,
  });
  expect(screen.getByRole("button", { name: "Prepaid credits" })).toBeTruthy();
});
it("shows customers purchase terms instead of a configuration editor", () => {
  state.role = "customer";
  show();
  expect(screen.getByText(/Choose a metered product/)).toBeTruthy();
  expect(screen.queryByLabelText("Billable unit")).toBeNull();
});

it("does not silently attach billing to a different product when an original product link is unavailable", () => {
  show("/demo/metered-usage?product=prod_foreign");
  expect(
    screen.queryByRole("button", { name: "Attach billing to product" }),
  ).toBeNull();
  expect(screen.getByText(/selected product is unavailable/)).toBeTruthy();
});
