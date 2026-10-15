// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PayoutSettings } from "./PayoutSettings.js";
afterEach(cleanup);
it("requires explicit consent and sends a precise combined minimum to the host callback", async () => {
  const onSave = vi.fn().mockResolvedValue({ status: "ready" });
  render(
    <PayoutSettings
      scopeKey="recipient"
      currency="usd"
      policy={null}
      onSave={onSave}
    />,
  );
  await userEvent.selectOptions(screen.getByRole("combobox"), "custom");
  await userEvent.type(
    screen.getByRole("textbox", { name: /Minimum/ }),
    "10.25",
  );
  expect(
    screen.getByRole("button", { name: "Save payout settings" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save payout settings" }),
  );
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      currency: "usd",
      mode: "custom",
      expectedRevision: -1,
      minimum: 1025,
      consent: true,
    }),
  );
  expect(await screen.findByText("Payout settings verified.")).toBeTruthy();
});
it("opts out account-wide without requiring custom consent or a numeric minimum", async () => {
  const onSave = vi.fn().mockResolvedValue({ status: "ready" });
  render(
    <PayoutSettings
      scopeKey="recipient"
      currency="usd"
      policy={{
        mode: "custom",
        status: "ready",
        revision: 2,
        thresholds: [{ currency: "usd", amount: 1000 }],
      }}
      onSave={onSave}
    />,
  );
  await userEvent.selectOptions(screen.getByRole("combobox"), "stripe_managed");
  await userEvent.click(
    screen.getByRole("button", { name: "Save payout settings" }),
  );
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      currency: "usd",
      mode: "stripe_managed",
      expectedRevision: 2,
      consent: false,
    }),
  );
});
it("shows a migration limitation without pretending settings were saved", async () => {
  render(
    <PayoutSettings
      scopeKey="recipient"
      currency="usd"
      policy={null}
      onSave={async () => ({
        status: "migration_required",
        reason: "existing_balance",
      })}
    />,
  );
  await userEvent.selectOptions(screen.getByRole("combobox"), "custom");
  await userEvent.type(screen.getByRole("textbox"), "10");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save payout settings" }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "reconciliation",
  );
  expect(screen.queryByText("Payout settings verified.")).toBeNull();
});
it("locks edits during a pending schedule operation and retries the host's persisted operation", async () => {
  const onRetry = vi.fn().mockResolvedValue({ status: "ready" });
  const onSave = vi.fn();
  render(
    <PayoutSettings
      scopeKey="recipient"
      currency="usd"
      policy={{
        mode: "custom",
        status: "changing",
        revision: 1,
        thresholds: [{ currency: "usd", amount: 1000 }],
      }}
      onSave={onSave}
      onRetry={onRetry}
    />,
  );
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Save payout settings" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry settings verification" }),
  );
  await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  expect(onSave).not.toHaveBeenCalled();
});
it.each(["0", "10.001", "-2", "1e3", "10,20"])(
  "does not round or submit invalid USD minimum %s",
  async (value) => {
    const onSave = vi.fn();
    render(
      <PayoutSettings
        scopeKey="recipient"
        currency="usd"
        policy={null}
        onSave={onSave}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "custom");
    await userEvent.type(screen.getByRole("textbox"), value);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Save payout settings" }),
    ).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  },
);
