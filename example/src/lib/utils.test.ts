import { expect, it } from "vitest";
import { cn } from "./utils";
it("preserves foreground colors alongside the example's control font size", () => {
  expect(cn("text-primary-foreground", "text-control-sm")).toBe(
    "text-primary-foreground text-control-sm",
  );
  expect(cn("text-sm", "text-control-sm")).toBe("text-control-sm");
});
