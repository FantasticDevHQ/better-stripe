import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorFallback } from "./app-error-fallback";

describe("AppErrorFallback", () => {
  it("shows safe recovery copy without exposing internal errors", () => {
    render(
      <AppErrorFallback
        error={new Error("Stripe secret leaked")}
        resetErrorBoundary={vi.fn()}
      />,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("Stripe secret leaked")).not.toBeInTheDocument();
  });

  it("invokes the boundary reset action", () => {
    const resetErrorBoundary = vi.fn();
    render(
      <AppErrorFallback
        error="non-error rejection"
        resetErrorBoundary={resetErrorBoundary}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(resetErrorBoundary).toHaveBeenCalledOnce();
  });
});
