import { readInitialLineage } from "./lineageAuthority.js";

const admitted = new WeakSet<object>();
import {
  ATTACHMENT_API_VERSION as API_VERSION,
  NODE_ATTACHMENT_PROFILE,
  supportsAttachmentProfile,
} from "../../attachmentProfile.js";
import type { InitialMaterial } from "../material/classifiers.js";
export { NODE_ATTACHMENT_PROFILE };
function covers(value: unknown, freshness: "retained" | "fresh") {
  if (!value || typeof value !== "object") return false;
  const material = value as InitialMaterial;
  return (
    material.classificationRevision === "renewal-material-v2" &&
    material.protocolRevision === "renewal-stage-protocol-v1" &&
    material.stage === "attach" &&
    material.intent === "initial" &&
    material.scope === "platform" &&
    material.apiVersion === API_VERSION &&
    material.freshness === freshness &&
    supportsAttachmentProfile({
      profile: material.profile,
      livemode: material.originalPrepared.expected.livemode,
      subscriptionDiscounts: material.subscriptionDiscounts,
      itemDiscounts: material.itemDiscounts,
    })
  );
}
/** Fixed Node/test-mode profile. Full material validation precedes these predicates. */
const entries = Object.freeze([
  Object.freeze({
    coversRetained(value: unknown) {
      return covers(value, "retained");
    },
    coversFresh(value: unknown) {
      return covers(value, "fresh");
    },
  }),
]);
/** Package-private admission after the public method wins the original reservation. */
export function admitNodeAttachmentLineage(token: object) {
  const lineage = readInitialLineage(token);
  const record = JSON.parse(lineage.reservation.recordJSON);
  if (
    record.profile !== NODE_ATTACHMENT_PROFILE ||
    record.account.livemode !== false
  )
    throw Error("NODE_ATTACHMENT_PROFILE_UNSUPPORTED");
  admitted.add(token);
}
export function initialEntriesForLineage(
  token: object | null,
  dormant: readonly unknown[],
) {
  return token !== null && admitted.has(token) ? entries : dormant;
}

export function isNodeAttachmentLineage(token: object) {
  return admitted.has(token);
}

const preflightEntries = Object.freeze([
  Object.freeze({
    originalEntry: entries[0],
    coversPreflight(record: unknown) {
      return coversConfiguration(record);
    },
  }),
]);
const writeEntries = Object.freeze([
  Object.freeze({
    originalEntry: entries[0],
    coversConfigure(record: unknown) {
      return coversConfiguration(record);
    },
  }),
]);
function coversConfiguration(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as {
    request?: {
      profile?: import("../../../renewalAggregate/profile.js").RenewalProfile;
    };
    configuration?: { preparation?: { expected?: { livemode?: boolean } } };
  };
  return (
    !!record.request?.profile &&
    supportsAttachmentProfile({
      profile: record.request.profile,
      livemode: record.configuration?.preparation?.expected?.livemode !== false,
      subscriptionDiscounts: [],
      itemDiscounts: [],
    })
  );
}
export function preflightEntriesForLineage(
  token: object,
  dormant: readonly unknown[],
) {
  return isNodeAttachmentLineage(token) ? preflightEntries : dormant;
}
export function writeEntriesForLineage(
  token: object,
  dormant: readonly unknown[],
) {
  return isNodeAttachmentLineage(token) ? writeEntries : dormant;
}
