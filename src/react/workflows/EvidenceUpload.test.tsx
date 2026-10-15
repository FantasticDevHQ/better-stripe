// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EvidenceUpload } from "./EvidenceUpload.js";
afterEach(cleanup);
it("uploads the selected file once, retains it on failure and retries as a draft", async () => {
  let reject!: (error: Error) => void;
  const upload = vi.fn(
    () =>
      new Promise<unknown>((_, fail) => {
        reject = fail;
      }),
  );
  render(<EvidenceUpload scopeKey="seller:dp_1" onUpload={upload} />);
  const file = new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Evidence file"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Attach to draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Uploading…" }));
  expect(upload).toHaveBeenCalledExactlyOnceWith(file);
  await act(async () => {
    reject(new Error("Upload unavailable"));
  });
  expect(screen.getByRole("alert").textContent).toBe("Upload unavailable");
  upload.mockResolvedValue({});
  fireEvent.click(screen.getByRole("button", { name: "Attach to draft" }));
  await act(async () => {});
  expect(upload).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toBe(
    "File attached to draft. Submit evidence separately when ready.",
  );
});
it("forgets another dispute's selected file", () => {
  const upload = vi.fn();
  const { rerender } = render(
    <EvidenceUpload scopeKey="seller:dp_1" onUpload={upload} />,
  );
  fireEvent.change(screen.getByLabelText("Evidence file"), {
    target: { files: [new File(["a"], "a.pdf")] },
  });
  rerender(<EvidenceUpload scopeKey="seller:dp_2" onUpload={upload} />);
  expect(
    (
      screen.getByRole("button", {
        name: "Attach to draft",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
