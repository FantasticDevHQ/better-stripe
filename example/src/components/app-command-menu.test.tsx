import type { InputHTMLAttributes, ReactNode } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppCommandMenu } from "./app-command-menu";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("cmdk", () => ({
  Command: {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Empty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({
      children,
      onSelect,
    }: {
      children: ReactNode;
      onSelect?: () => void;
    }) => <button onClick={onSelect}>{children}</button>,
  },
}));

afterEach(() => navigate.mockReset());

describe("AppCommandMenu", () => {
  it("opens with Ctrl+K and ignores repeated keydown events", () => {
    render(<AppCommandMenu />);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true, repeat: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("navigates to the selected destination and closes", () => {
    render(<AppCommandMenu />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Admin overview" }));

    expect(navigate).toHaveBeenCalledWith("/admin");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
