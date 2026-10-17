import assert from "node:assert/strict";

// Exercise the emitted package graph with Node's standard ESM resolver.
// Bundled source tests cannot detect missing extensions in this graph.
const sdk = await import("@fantastic.dev/better-stripe");
const react = await import("@fantastic.dev/better-stripe/react");
const testing = await import("@fantastic.dev/better-stripe/testing");

assert.equal(typeof sdk.BetterStripe, "function");
assert.equal(typeof react.Checkout, "function");
assert.equal(typeof react.PlanPricingEditor, "function");
assert.equal(typeof testing.createTestAccount, "function");

console.log("Compiled public SDK, React and testing exports load in Node ESM");
