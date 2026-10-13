import { expect, it } from "vitest";
import { webhookQueryArgs } from "./filters.js";
it("omits all sentinels from server filters", () => {
  expect(webhookQueryArgs("all", "all")).toEqual({
    eventType: undefined,
    status: undefined,
  });
  expect(webhookQueryArgs("invoice.paid", "failed")).toEqual({
    eventType: "invoice.paid",
    status: "failed",
  });
});
