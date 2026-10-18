import type { Doc } from "../../component/_generated/dataModel.js";
/** Local restoration requires proof that no native meter event was accepted. */
export function locallyCancelable(
  outbox: Pick<
    Doc<"usageOutbox">,
    "attempts" | "firstSendAt" | "receipt" | "state" | "reason"
  >,
): boolean {
  return (
    !outbox.receipt &&
    ((outbox.attempts === 0 && outbox.firstSendAt === undefined) ||
      (outbox.state === "rejected" && outbox.reason === "provider_rejected"))
  );
}
