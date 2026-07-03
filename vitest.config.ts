/**
 * Vitest configuration for the better-stripe package.
 *
 * Projects:
 *  1. "component" — src/component tests (Convex component, edge-runtime)
 *  2. "example"   — example/convex tests (example app, edge-runtime)
 *  3. "client"    — src/client tests (BetterStripe client library)
 *  4. "react"     — src/react tests (React hooks and components)
 *  5. "testing"   — src/testing tests (test utility exports)
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: true,
    projects: [
      {
        test: {
          name: "component",
          include: ["src/component/**/*.test.{ts,js}"],
          exclude: ["dist/**", "node_modules/**"],
          environment: "edge-runtime",
        },
      },
      {
        test: {
          name: "example",
          include: [
            "example/convex/**/*.test.{ts,js}",
            // Frontend helper unit tests (pure logic; no DOM) live under
            // example/src/lib — cover them here so the gate runs them too.
            "example/src/**/*.test.{ts,tsx}",
          ],
          exclude: ["dist/**", "node_modules/**"],
          environment: "edge-runtime",
        },
      },
      {
        test: {
          name: "client",
          include: ["src/client/**/*.test.{ts,js}"],
          exclude: ["dist/**", "node_modules/**"],
        },
      },
      {
        test: {
          name: "react",
          include: ["src/react/**/*.test.{ts,tsx}"],
          exclude: ["dist/**", "node_modules/**"],
        },
      },
      {
        test: {
          name: "testing",
          include: ["src/testing/**/*.test.{ts,js}"],
          exclude: ["dist/**", "node_modules/**"],
        },
      },
    ],
  },
});
