import type {
  AttachRenewalScheduleOptions,
  AttachRenewalScheduleResult,
  RenewalAttachmentActionCtx,
} from "./renewalAttachmentTypes.js";
export type AttachmentExecutor = (
  root: object,
  ctx: RenewalAttachmentActionCtx,
  options: AttachRenewalScheduleOptions,
) => Promise<AttachRenewalScheduleResult>;
let nodeExecutor: AttachmentExecutor | undefined;
/** Private registration from the public Node entrypoint only. */
export function bindNodeAttachmentExecutor(executor: AttachmentExecutor) {
  if (nodeExecutor && nodeExecutor !== executor)
    throw Error("RENEWAL_ATTACHMENT_RUNTIME_ALREADY_BOUND");
  nodeExecutor = executor;
}
export async function invokeNodeAttachment(
  root: object,
  ctx: RenewalAttachmentActionCtx,
  options: AttachRenewalScheduleOptions,
): Promise<AttachRenewalScheduleResult> {
  if (!nodeExecutor) throw Error("RENEWAL_ATTACHMENT_REQUIRES_NODE_ENTRYPOINT");
  return nodeExecutor(root, ctx, options);
}
