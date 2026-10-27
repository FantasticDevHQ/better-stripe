import { expect, it } from "vitest";
import * as projection from "./renewalProjection/itemSettings.js";

const input = () => ({
  effectiveAutomaticTax: false,
  livemode: false,
  settings: { billing_thresholds: null, tax_rates: [], metadata: null },
});
it("preserves explicit empty item rates as a clear override", () => {
  expect(projection.projectRenewalItemSettings(input())).toEqual({
    status: "projected",
    settings: { tax_rates: "" },
    requiresProviderQualification: true,
  });
});
it("keeps absent tax overrides absent and null metadata without actions", () => {
  expect(
    projection.projectRenewalItemSettings({
      ...input(),
      settings: { billing_thresholds: null, metadata: null },
    }),
  ).toMatchObject({ status: "projected", settings: {} });
});
it("maps ordered item tax IDs and exact metadata without changing reads", () => {
  const value = {
    ...input(),
    settings: {
      billing_thresholds: null,
      tax_rates: ["first", "second"].map((name) => ({
        id: `txr_${name}`,
        object: "tax_rate",
        livemode: false,
      })),
      metadata: { original: "kept" },
    },
  };
  const before = structuredClone(value);
  expect(projection.projectRenewalItemSettings(value)).toMatchObject({
    status: "projected",
    settings: {
      tax_rates: ["txr_first", "txr_second"],
      metadata: { original: "kept" },
    },
  });
  expect(value).toEqual(before);
});
it.each([
  { billing_thresholds: { usage_gte: 100 } },
  { metadata: { unset: "" } },
  { tax_rates: [{ id: "txr_live", object: "tax_rate", livemode: true }] },
  {
    tax_rates: [
      { id: "txr_deleted", object: "tax_rate", livemode: false, deleted: true },
    ],
  },
  { unknown_future_setting: true },
])("rejects unsupported item state %j", (extra) => {
  expect(
    projection.projectRenewalItemSettings({
      ...input(),
      settings: {
        ...input().settings,
        ...extra,
      },
    }).status,
  ).toBe("unsupported");
});
it("rejects item rates under inherited effective automatic tax", () => {
  expect(
    projection.projectRenewalItemSettings({
      ...input(),
      effectiveAutomaticTax: true,
      settings: {
        ...input().settings,
        tax_rates: [{ id: "txr_manual", object: "tax_rate", livemode: false }],
      },
    }).status,
  ).toBe("unsupported");
});
