/** Private version1 evidence DATA shapes. No public SDK entry or authority. */
import type {
  ProjectRenewalConfigurationV2Options,
  ConstructRenewalConfigurationReceiptV2Options,
} from "../renewalV2/index.js";
import type { RenewalScheduleMaterialReads } from "../renewalV2/observation.js";

export type API = "2026-09-30.endive";
export type Period = Readonly<{ start: number; end: number }>;
export type Presence<T> =
  | Readonly<{ presence: "absent" }>
  | Readonly<{ presence: "present"; value: T }>;
export type Reason =
  | "not_supplied"
  | "unsupported_api_version"
  | "unsupported_profile"
  | "incomplete_material"
  | "owned_identity_mismatch"
  | "material_mismatch"
  | "terminal_completion_unproven"
  | "invalid_terminal_field"
  | "ambiguous_items"
  | "incomplete_invoice_lines"
  | "unsupported_invoice_reason"
  | "invoice_relation_mismatch"
  | "invoice_material_mismatch"
  | "snapshot_relation_mismatch";

export type InvoiceInventoryV1 = Readonly<{
  invoice: unknown;
  linePages: readonly unknown[];
}>;
export type InvoiceContextV1 = Readonly<{
  original: InvoiceInventoryV1;
  current: InvoiceInventoryV1;
}>;
export type HistoricalSnapshotV1 = Readonly<{
  reads: RenewalScheduleMaterialReads;
  invoiceContext: InvoiceContextV1 | null;
}>;

// Exactly seven own enumerable DATA keys, all REQUIRED; no undefined aliases.
// Raw provider resource/page bodies preserve every admitted unknown own field.
export type RenewalEvidenceInputV1 = Readonly<{
  version: 1;
  apiVersion: API;
  configuration: ProjectRenewalConfigurationV2Options;
  configureReceipt: ConstructRenewalConfigurationReceiptV2Options | null;
  reads: RenewalScheduleMaterialReads;
  invoiceContext: InvoiceContextV1 | null;
  historicalSnapshot: HistoricalSnapshotV1 | null;
}>;

export type IdentityV1 = Readonly<{
  scope: "platform";
  customerAccountId: string;
  customerId: string;
  livemode: boolean;
  scheduleId: string;
  subscriptionId: string;
  originalItemId: string;
  targetPriceId: string;
  targetProductId: string;
  originalNativePeriod: Period;
  targetBoundary: number;
}>;
export type TerminalFactsV1 = Readonly<{
  canceledAt: Presence<number | null>;
  completedAt: Presence<number | null>;
  releasedAt: Presence<number | null>;
  subscriptionId: Presence<string | null>;
  releasedSubscriptionId: Presence<string | null>;
}>;
export type CompletionV1 = Readonly<{
  scheduleId: string;
  subscriptionId: string;
  completedAt: number;
  targetPeriod: Period;
  finalPhaseEnd: number;
  endBehavior: "release";
  comparison: "full_normalized_phase_history_match";
}>;
export type LifecycleV1 =
  | Readonly<{
      predicate: "status_only";
      providerStatus: "not_started" | "active";
      facts: null;
      completion: null;
      reason: null;
    }>
  | Readonly<{
      predicate: "status_only";
      providerStatus: "canceled" | "released";
      facts: TerminalFactsV1;
      completion: null;
      reason: null;
    }>
  | Readonly<{
      predicate: "completed_correlated";
      providerStatus: "completed";
      facts: TerminalFactsV1;
      completion: CompletionV1;
      reason: null;
    }>
  | Readonly<{
      predicate: "unknown" | "conflict";
      providerStatus: string | null;
      facts: TerminalFactsV1 | null;
      completion: null;
      reason: Reason;
    }>;
export type MaterialMatchV1 = Readonly<{
  predicate: "current_target_material_match";
  observedItemId: string;
  nativePeriod: Period;
  reason: null;
}>;
export type CurrentMaterialV1 =
  | MaterialMatchV1
  | Readonly<{
      predicate: "attached_unconfigured_match" | "pending_material_match";
      observedItemId: null;
      nativePeriod: null;
      reason: null;
    }>
  | Readonly<{
      predicate: "unknown" | "conflict";
      observedItemId: null;
      nativePeriod: null;
      reason: Reason;
    }>;
export type HistoricalMaterialV1 =
  | Readonly<{
      predicate: "snapshot_target_material_match";
      observedItemId: string;
      nativePeriod: Period;
      reason: null;
    }>
  | Readonly<{
      predicate: "unknown" | "conflict";
      observedItemId: null;
      nativePeriod: null;
      reason: Reason;
    }>;
export type InvoiceLineMatchV1 = Readonly<{
  invoiceId: string;
  lineId: string;
  subscriptionItemId: string;
  nativePeriod: Period;
  priceId: string;
  productId: string;
  currency: string;
  quantityDecimal: string;
  unitAmountDecimal: string;
  invoiceStatus: "draft" | "open" | "paid" | "uncollectible" | "void" | null;
}>;
export type InvoiceEvidenceV1 =
  | Readonly<{
      predicate: "invoice_lines_correlated";
      original: InvoiceLineMatchV1;
      current: InvoiceLineMatchV1;
      reason: null;
    }>
  | Readonly<{
      predicate: "unknown" | "conflict";
      original: null;
      current: null;
      reason: Reason;
    }>;

// Exactly twelve own enumerable keys. Every nested union is closed as written.
// This result never enters the existing owned-observation output admission.
export type RenewalEvidenceResultV1 = Readonly<{
  version: 1;
  kind: "renewal_evidence_data";
  apiVersion: API;
  identity: IdentityV1 | null;
  lifecycle: LifecycleV1;
  currentMaterial: CurrentMaterialV1;
  historicalMaterial: HistoricalMaterialV1;
  invoiceEvidence: InvoiceEvidenceV1;
  acknowledgementEstablished: false;
  authenticationEstablished: false;
  operationalAuthority: false;
  providerQualificationRequired: true;
}>;
