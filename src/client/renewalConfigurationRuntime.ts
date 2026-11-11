import type { RenewalAttachmentActionCtx } from "./renewalAttachmentTypes.js";
import type {
  ConfigureRenewalScheduleOptions,
  ConfigureRenewalScheduleResult,
} from "./renewalConfigurationTypes.js";
export type ConfigurationExecutor = (
  root: object,
  ctx: RenewalAttachmentActionCtx,
  options: ConfigureRenewalScheduleOptions,
) => Promise<ConfigureRenewalScheduleResult>;
let executor: ConfigurationExecutor | undefined;
export function bindNodeConfigurationExecutor(value: ConfigurationExecutor) {
  if (executor && executor !== value)
    throw Error("RENEWAL_CONFIGURATION_RUNTIME_ALREADY_BOUND");
  executor = value;
}
export async function invokeNodeConfiguration(
  root: object,
  ctx: RenewalAttachmentActionCtx,
  options: ConfigureRenewalScheduleOptions,
) {
  if (!executor) throw Error("RENEWAL_CONFIGURATION_REQUIRES_NODE_ENTRYPOINT");
  return executor(root, ctx, options);
}
