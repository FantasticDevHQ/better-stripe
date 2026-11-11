import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { assertNoTestArtifacts } from "./check-dist-artifacts.mjs";

// The published tarball ships `dist` verbatim; tests and fixtures must not be in it.
assertNoTestArtifacts(fileURLToPath(new URL("../dist", import.meta.url)));

// Exercise the emitted package graph with Node's standard ESM resolver.
// Bundled source tests cannot detect missing extensions in this graph.
const sdk = await import("@fantastic.dev/better-stripe");
const react = await import("@fantastic.dev/better-stripe/react");
const testing = await import("@fantastic.dev/better-stripe/testing");
const node = await import("@fantastic.dev/better-stripe/node");

assert.equal(typeof sdk.BetterStripe, "function");
assert.equal(node.BetterStripe, sdk.BetterStripe);
assert.equal(
  typeof node.BetterStripe.prototype.attachRenewalSchedule,
  "function",
);
assert.equal(typeof sdk.prepareRenewalAttachmentOperation, "function");
assert.equal(typeof sdk.qualifyCapturedCheckoutPayment, "function");
assert.equal(typeof react.Checkout, "function");
assert.equal(typeof react.PlanPricingEditor, "function");
assert.equal(typeof testing.createTestAccount, "function");

console.log("Compiled public SDK, React and testing exports load in Node ESM");
