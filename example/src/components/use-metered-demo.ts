import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { useWorkflowAction } from "@fantastic.dev/better-stripe/react";
import type {
  UsageBillingModel,
  UsageConfigurationValue,
} from "@fantastic.dev/better-stripe/usage";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
type Operation =
  | "setup"
  | "configure"
  | "consume"
  | "replay"
  | "correct"
  | "observe"
  | "purchase"
  | "confirm"
  | "deliver"
  | "bill"
  | "archive";
function message(kind: Operation, value: Record<string, unknown>): string {
  if (kind === "setup" || kind === "configure")
    return "Native sandbox setup is ready.";
  if (kind === "consume" || kind === "replay")
    return value.status === "accepted"
      ? value.work === "already_completed"
        ? "Original work replayed. No new work or units accepted."
        : "Usage accepted. Synthetic work completed once."
      : value.status === "denied"
        ? "Work denied. No work ran or new cash was collected."
        : "Work held. Confirm payment or reconcile credits before retrying.";
  if (kind === "deliver")
    return "Queued original deliveries scheduled. Unknown attempts remain held.";
  if (kind === "bill")
    return value.status === "paid"
      ? "Native invoice paid. Review original cash verification below."
      : "Original billing close is pending. Resume after native evidence is ready.";
  if (kind === "archive")
    return value.status === "archived"
      ? "Owned recurring resources stopped. History is retained; a new run can be configured."
      : "Scoped cleanup is pending. Resume the original cleanup.";
  if (kind === "purchase")
    return "Payment pending. Credits remain unavailable until verified capture.";
  if (kind === "confirm")
    return value.state === "ready"
      ? "Payment verified. Original credits are ready."
      : "Payment or grant verification is pending.";
  if (kind === "correct")
    return value.state === "confirmed"
      ? "Original event cancellation confirmed."
      : "Cancellation retained. Refresh native evidence before retrying; no automatic refund was issued.";
  return value.status === "available"
    ? "Native observation refreshed. Aggregation can lag accepted usage."
    : "Native aggregation is not yet available. Refresh again later.";
}
/** Demo work and purchase identities only. The package owns action lifecycle and all billing decisions. */
export function useMeteredDemo(
  actorId: Id<"users">,
  model: UsageBillingModel,
  run: Doc<"meteredDemoRuns"> | null,
  canConfigure: boolean,
) {
  const setup = useAction(api.meteredUsage.setup.setup);
  const consume = useAction(api.meteredUsage.activities.consume);
  const replay = useAction(api.meteredUsage.activities.replay);
  const correct = useAction(api.meteredUsage.activities.correct);
  const observe = useAction(api.meteredUsage.readers.observe);
  const purchase = useAction(api.meteredUsage.funding.purchase);
  const deliver = useAction(api.meteredUsage.activities.deliverQueued);
  const bill = useAction(api.meteredUsage.billing.closePeriod);
  const archive = useAction(api.meteredUsage.cleanup.archive);
  const confirm = useAction(api.meteredUsage.funding.confirm);
  const [revision, setRevision] = useState(0);
  const [retryingWork, setRetryingWork] = useState(false);
  const workId = useRef<string | null>(null);
  const purchaseId = useRef<string | null>(null);
  const action = useWorkflowAction(
    async (kind: Operation, configuration?: UsageConfigurationValue) => {
      try {
        if (kind === "setup" || kind === "configure") {
          await setup({
            actorId,
            model,
            ...(configuration
              ? { configurationJson: JSON.stringify(configuration) }
              : run && canConfigure
                ? { configurationJson: run.configurationJson }
                : {}),
          });
          return message(kind, {});
        }
        if (!run) throw new Error();
        const ref = { actorId, runId: run._id };
        let result: string;
        if (kind === "consume") {
          workId.current ??= crypto.randomUUID();
          setRetryingWork(true);
          result = await consume({
            ...ref,
            requestId: workId.current,
            quantity: "5",
          });
        } else if (kind === "purchase") {
          purchaseId.current ??= crypto.randomUUID();
          result = await purchase({ ...ref, requestId: purchaseId.current });
        } else if (kind === "replay") result = await replay(ref);
        else if (kind === "correct") result = await correct(ref);
        else if (kind === "confirm") result = await confirm(ref);
        else if (kind === "deliver") result = await deliver(ref);
        else if (kind === "bill") result = await bill(ref);
        else if (kind === "archive") result = await archive(ref);
        else result = await observe(ref);
        const value = JSON.parse(result) as Record<string, unknown>;
        if (
          (kind === "consume" || kind === "replay") &&
          ["accepted", "denied"].includes(String(value.status))
        ) {
          workId.current = null;
          setRetryingWork(false);
        }
        if (kind === "confirm" && value.state === "ready")
          purchaseId.current = null;
        return message(kind, value);
      } catch {
        throw new Error(
          "Sandbox operation could not complete. Retry the original operation or review the setup runbook.",
        );
      }
    },
    JSON.stringify([actorId, model, run?._id]),
    () => setRevision((value) => value + 1),
  );
  return { ...action, revision, retryingWork };
}
