import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResetCard } from "./setup-reset";

const resetAll = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useAction: () => resetAll }));

beforeEach(() => {
  resetAll.mockReset();
});

describe("reset card", () => {
  it("asks for confirmation before resetting and does nothing on cancel", async () => {
    render(<ResetCard />);
    fireEvent.click(screen.getByRole("button", { name: "Reset All Data" }));
    expect(
      await screen.findByRole("heading", { name: "Reset all data?" }),
    ).toBeInTheDocument();
    expect(resetAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Reset all data?" }),
      ).not.toBeInTheDocument(),
    );
    expect(resetAll).not.toHaveBeenCalled();
  });

  it("resets only after the destructive action is confirmed", async () => {
    resetAll.mockResolvedValue(null);
    render(<ResetCard />);
    fireEvent.click(screen.getByRole("button", { name: "Reset All Data" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, reset everything" }),
    );
    await waitFor(() => expect(resetAll).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/All data cleared/)).toBeInTheDocument();
  });

  it("shows the server refusal, such as a live Stripe key", async () => {
    resetAll.mockRejectedValue(new Error("not a test-mode key"));
    render(<ResetCard />);
    fireEvent.click(screen.getByRole("button", { name: "Reset All Data" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, reset everything" }),
    );
    expect(await screen.findByText(/not a test-mode key/)).toBeInTheDocument();
  });
});
