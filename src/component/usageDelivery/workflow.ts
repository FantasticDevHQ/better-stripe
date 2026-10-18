import { anyApi } from "convex/server";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { refFields } from "./schema.js";
import { v } from "convex/values";
export const run = executionWorkflow
  .define({ args: refFields, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    let sends = 0;
    for (let turn = 0; turn < 40; turn++) {
      const claimed = await step.runMutation(
        anyApi.usageDelivery.steps.claim,
        args,
        { name: `claim-${turn}` },
      );
      if (claimed.kind === "done") return null;
      if (claimed.kind === "wait") {
        await step.sleep(claimed.delayMs);
        continue;
      }
      const outcome = await step.runAction(
        anyApi.usageDelivery.bridge.invoke,
        claimed.request,
        { name: `provider-${turn}`, retry: false },
      );
      const saved = await step.runMutation(
        anyApi.usageDelivery.steps.save,
        { ...claimed.request, outcome },
        { name: "save-receipt" },
      );
      sends++;
      if (saved.state !== "queued") return null;
      if (sends >= 3) break;
    }
    await step.runMutation(anyApi.usageDelivery.steps.exhaust, args);
    return null;
  });
