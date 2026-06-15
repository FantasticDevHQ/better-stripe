// @vitest-environment edge-runtime
/**
 * Test setup for the better-stripe package.
 *
 * Provides shared helpers for convex-test integration tests:
 * - `initConvexTest` — creates a typed convex-test instance with component modules
 * - `components` — typed mock of the component API via componentsGeneric()
 */
import { convexTest } from "convex-test";
import {
  type GenericSchema,
  type SchemaDefinition,
  componentsGeneric,
  defineSchema,
} from "convex/server";
import { expect, test } from "vitest";

import type { ComponentApi } from "../component/_generated/component.js";

// Load all component modules (ts/js/tsx/jsx) for convex-test's in-memory runtime
const modules = import.meta.glob("../component/**/*.{ts,js,tsx,jsx}");

/**
 * Create a typed convex-test instance preloaded with the component's modules.
 * Defaults to an empty schema when none is provided.
 */
export function initConvexTest<
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(schema?: Schema) {
  return convexTest(schema ?? defineSchema({}), modules);
}

/**
 * Typed mock of the betterStripe component API surface.
 * Uses componentsGeneric() cast to ComponentApi — satisfies TypeScript
 * without a real Convex deployment. Only the `public` key is typed;
 * `private` functions are accessed via `as any` in tests that verify
 * internal mutation calls.
 */
export const components = componentsGeneric() as unknown as {
  betterStripe: ComponentApi;
};

test("setup exports are defined", () => {
  expect(initConvexTest).toBeTypeOf("function");
  expect(components.betterStripe).toBeDefined();
});
