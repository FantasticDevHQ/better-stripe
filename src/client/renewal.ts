/** Public pure renewal preparation functions and their input/result types. */
export type {
  AttachRenewalScheduleOptions,
  AttachRenewalScheduleResult,
  RenewalAttachmentAuthorization,
} from "./renewalAttachmentTypes.js";
export { prepareRenewalPriceReplacement } from "./billing/renewalPriceReplacement.js";
export type {
  PrepareRenewalPriceReplacementOptions,
  PreparedRenewalPriceReplacement,
} from "./billing/renewalPriceReplacement.js";
export type { RenewalPriceReplacementExpected } from "./billing/renewalReplacementSchema.js";
export { prepareRenewalScheduleAttachment } from "./billing/renewalAttach/request.js";
export type {
  PrepareRenewalScheduleAttachmentOptions,
  PreparedRenewalScheduleAttachment,
} from "./billing/renewalAttach/request.js";
export type { ReadRenewalPriceReplacementContextOptions } from "./billing/renewalAttach/reader.js";
export {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
  projectRenewalConfigurationV2,
  constructRenewalConfigurationReceiptV2,
} from "./billing/renewalV2/index.js";
export type {
  PrepareRenewalPriceReplacementV2Options,
  PreparedRenewalPriceReplacementV2,
  PrepareRenewalScheduleAttachmentV2Options,
  PreparedRenewalScheduleAttachmentV2,
  ConstructRenewalScheduleAttachmentReceiptV2Options,
  RenewalScheduleAttachmentReceiptV2,
  ProjectRenewalConfigurationV2Options,
  ProjectedRenewalConfigurationV2,
  RenewalConfigurationProjectionFailure,
  ConstructRenewalConfigurationReceiptV2Options,
  RenewalConfigurationReceiptV2,
} from "./billing/renewalV2/index.js";

export { inspectRenewalScheduleMaterialV2 } from "./billing/renewalV2/observation.js";
export type {
  InspectRenewalScheduleMaterialV2Options,
  RenewalScheduleMaterialReads,
  RenewalScheduleMaterialObservationV2,
} from "./billing/renewalV2/observation.js";

export {
  prepareRenewalAttachmentOperation,
  type PrepareRenewalAttachmentOperationOptions,
} from "./renewalAttachmentPreparation.js";

export { prepareRenewalConfigurationOperation } from "./renewalConfigurationPreparation.js";
export type {
  ConfigureRenewalScheduleOptions,
  ConfigureRenewalScheduleResult,
  RenewalConfigurationAuthorization,
} from "./renewalConfigurationTypes.js";
