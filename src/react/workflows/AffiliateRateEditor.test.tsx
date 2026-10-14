// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AffiliateRateEditor } from "./AffiliateRateEditor.js";
afterEach(cleanup);
it("saves a percentage, clears to inherit, and rejects invalid decimals", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <AffiliateRateEditor
      scopeKey="price"
      affiliateBasisPoints={null}
      effectiveBasisPoints={2000}
      source="plan"
      version={0}
      onSave={save}
    />,
  );
  const input = screen.getByLabelText("Affiliate payout (%)");
  await userEvent.type(input, "12.5");
  await userEvent.click(screen.getByRole("button", { name: "Save payout" }));
  expect(save).toHaveBeenLastCalledWith({
    affiliateBasisPoints: 1250,
    expectedVersion: 0,
  });
  await userEvent.clear(input);
  await userEvent.click(screen.getByRole("button", { name: "Save payout" }));
  expect(save).toHaveBeenLastCalledWith({
    affiliateBasisPoints: null,
    expectedVersion: 0,
  });
  await userEvent.type(input, "100.001");
  await userEvent.click(screen.getByRole("button", { name: "Save payout" }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert").textContent).toMatch(/percentage/i);
});
