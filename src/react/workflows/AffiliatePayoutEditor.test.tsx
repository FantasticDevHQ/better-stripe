// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AffiliatePayoutEditor } from "./AffiliatePayoutEditor.js";
afterEach(cleanup);
it("saves either a percentage or a currency amount and clears inheritance", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <AffiliatePayoutEditor
      scopeKey="price"
      affiliateBasisPoints={null}
      effectiveBasisPoints={2000}
      version={0}
      currency="eur"
      onSave={save}
    />,
  );
  const input = screen.getByLabelText("Affiliate payout");
  await userEvent.type(input, "12.5");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenLastCalledWith({
    affiliateBasisPoints: 1250,
    affiliateFixedAmount: null,
    expectedVersion: 0,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Fixed amount in EUR" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenLastCalledWith({
    affiliateBasisPoints: null,
    affiliateFixedAmount: 12.5,
    expectedVersion: 0,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Clear affiliate payout" }),
  );
  expect(save).toHaveBeenLastCalledWith({
    affiliateBasisPoints: null,
    affiliateFixedAmount: null,
    expectedVersion: 0,
  });
  expect((input as HTMLInputElement).value).toBe("");
});
it("rejects excessive percentages and invalid decimals", async () => {
  const save = vi.fn();
  render(
    <AffiliatePayoutEditor
      scopeKey="product"
      affiliateBasisPoints={null}
      effectiveBasisPoints={2000}
      version={0}
      onSave={save}
    />,
  );
  await userEvent.type(screen.getByLabelText("Affiliate payout"), "101");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert").textContent).toMatch(/100/);
  expect(save).not.toHaveBeenCalled();
});
