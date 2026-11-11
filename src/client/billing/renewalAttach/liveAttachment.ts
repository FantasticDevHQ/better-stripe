import type { InitialInvocationCore } from "./internal/producer/invocationProducer.js";
import type { RenewalAttachmentActionCtx } from "../../renewalAttachmentTypes.js";
type Live = {
  core: InitialInvocationCore;
  basis: InitialInvocationCore["owner"]["basis"];
  ctx: RenewalAttachmentActionCtx;
  timer: ReturnType<typeof setTimeout>;
};
const roots = new WeakMap<object, Map<string, Live>>();
export function retainLiveAttachment(
  root: object,
  operationId: string,
  ctx: RenewalAttachmentActionCtx,
  core: InitialInvocationCore,
  end: number,
) {
  let entries = roots.get(root);
  if (!entries) {
    entries = new Map();
    roots.set(root, entries);
  }
  const timer = setTimeout(
    () => {
      entries.delete(operationId);
      core.owner.retire();
    },
    Math.max(0, end - Date.now()),
  );
  timer.unref?.();
  entries.set(operationId, { core, ctx, timer, basis: core.owner.basis });
}
export function consumeLiveAttachment(
  root: object,
  operationId: string,
  ctx: RenewalAttachmentActionCtx,
) {
  const entries = roots.get(root),
    live = entries?.get(operationId);
  if (!live || live.ctx !== ctx) return null;
  entries!.delete(operationId);
  clearTimeout(live.timer);
  return live;
}
