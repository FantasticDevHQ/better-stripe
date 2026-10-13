import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountConfigurations } from "./account-configurations";
import { CopyButton, StatusBadge } from "./setup-controls";
import { EnvVarsCard } from "./setup-env-vars";

const checkEnvVars = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useAction: () => checkEnvVars }));

beforeEach(() => {
  checkEnvVars.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("setup controls", () => {
  it("copies the command and restores the button label", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CopyButton text="pnpm run check:all" label="Copy command" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    });
    expect(writeText).toHaveBeenCalledWith("pnpm run check:all");
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole("button", { name: "Copy command" }),
    ).toBeInTheDocument();
  });

  it("renders meaningful configuration labels and preserves unknown names", () => {
    const { rerender } = render(<AccountConfigurations configurations={[]} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    rerender(
      <AccountConfigurations
        configurations={["recipient", "customer", "merchant", "future"]}
      />,
    );
    expect(screen.getByText("Recipient (payouts)")).toBeInTheDocument();
    expect(screen.getByText("Customer (billable)")).toBeInTheDocument();
    expect(screen.getByText("Merchant (card payments)")).toBeInTheDocument();
    expect(screen.getByText("future")).toBeInTheDocument();
  });

  it("shows configured and missing environment variables, and refreshes", async () => {
    checkEnvVars.mockResolvedValueOnce({
      stripeSecretKey: false,
      webhookSecret: true,
      webhookSecretV2: false,
    });
    render(<EnvVarsCard />);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(
      await screen.findByText(/Set your Stripe secret key first/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getByText("Set")).toBeInTheDocument();
    checkEnvVars.mockResolvedValueOnce({
      stripeSecretKey: true,
      webhookSecret: true,
      webhookSecretV2: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByText("All environment variables are set."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("allows retrying when the initial environment check fails", async () => {
    checkEnvVars.mockRejectedValueOnce(new Error("Unavailable"));
    render(<EnvVarsCard />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    checkEnvVars.mockResolvedValueOnce({
      stripeSecretKey: true,
      webhookSecret: false,
      webhookSecretV2: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByText("STRIPE_WEBHOOK_SECRET_V2"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("All environment variables are set."),
    ).not.toBeInTheDocument();
  });

  it("supports a custom status label", () => {
    render(<StatusBadge ok={true} label="Verified" />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
});
