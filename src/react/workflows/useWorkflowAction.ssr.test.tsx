// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useWorkflowAction } from "./useWorkflowAction.js";

it("renders idle on the server without invoking actions or layout effects", () => {
  const action = vi.fn(async () => "observed");
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  function Consumer() {
    const observation = useWorkflowAction(action);
    return <p>{observation.isPending ? "pending" : "idle"}</p>;
  }
  try {
    expect(renderToString(<Consumer />)).toBe("<p>idle</p>");
    expect(action).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});
