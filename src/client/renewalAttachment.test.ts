import { expect, it } from "vitest";
import { BetterStripe } from "./index.js";
import { components } from "../../example/convex/_generated/api.js";

it("exposes attachment but refuses the ordinary runtime before accessing the Action", async () => {
  const client = new BetterStripe(components.betterStripe);
  const method = (
    client as unknown as {
      attachRenewalSchedule?: (
        ctx: unknown,
        options: unknown,
      ) => Promise<unknown>;
    }
  ).attachRenewalSchedule;
  expect(method).toBeTypeOf("function");
  await expect(method!.call(client, null, null)).rejects.toThrow(
    "RENEWAL_ATTACHMENT_REQUIRES_NODE_ENTRYPOINT",
  );
});

it("refuses configuration in the ordinary runtime before accessing the Action", async () => {
  const client = new BetterStripe(components.betterStripe);
  await expect(
    client.configureRenewalSchedule(null as never, null as never),
  ).rejects.toThrow("RENEWAL_CONFIGURATION_REQUIRES_NODE_ENTRYPOINT");
});
