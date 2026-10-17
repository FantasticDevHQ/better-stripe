import { v } from "convex/values";
import { internal } from "../../_generated/api.js";
import { executionWorkflow } from "../../durableExecution/runtime.js";
import { workflowRefFields } from "../workflowValidators.js";
export const run = executionWorkflow.define({
  args: workflowRefFields,
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    const plan = await step.runQuery(
      internal.balanceFunding.internal.queries.plan,
      args,
      { name: "plan-v1" },
    );
    for (const phase of plan.kind === "prepare"
      ? (["create", "attach"] as const)
      : (["apply"] as const)) {
      const phaseArgs = {
        ...args,
        phase,
        providerKey:
          phase === "apply"
            ? plan.applyKey
            : phase === "create"
              ? plan.createKey!
              : plan.attachKey!,
      };
      const result = await step.runAction(
        internal.balanceFunding.internal.actions.bridge,
        phaseArgs,
        { name: `${phase}-provider-v1`, retry: false },
      );
      if (result.status !== "ready")
        throw new Error(
          "Balance funding provider outcome requires reconciliation.",
        );
      await step.runMutation(
        internal.balanceFunding.internal.mutations.recordProviderReceipt,
        { ...phaseArgs, receipt: result.value },
        { name: `${phase}-record-v1` },
      );
    }
    await step.runMutation(
      internal.balanceFunding.internal.mutations.finishFromReceipts,
      args,
      { name: "finish-v1" },
    );
    return null;
  },
});
