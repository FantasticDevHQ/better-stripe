import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "../_generated/api.js";

// Workflow owns its Workpool. Do not enqueue workflow steps in a second pool.
// Provider writes require phase-specific reconciliation before any replay;
// throwing from an action does not prove the provider rejected its effect.
export const executionWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 2,
    retryActionsByDefault: false,
  },
});
