/**
 * Vitest configuration for the better-stripe package.
 *
 * Projects:
 *  1. "component" — src/component tests (Convex component, edge-runtime)
 *  2. "example"   — example/convex tests (example app, edge-runtime)
 *  3. "client"    — src/client tests (BetterStripe client library)
 *  4. "react"     — src/react tests (React hooks and components)
 *  5. "testing"   — src/testing tests (test utility exports)
 *  6. "scripts"   — scripts/ tests (repo tooling, e.g. codegen drift check)
 */
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./example/src", import.meta.url)),
    },
  },
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
            "example/src/lib/**/*.test.{ts,tsx}",
          ],
          exclude: ["dist/**", "node_modules/**"],
          environment: "edge-runtime",
        },
      },
      {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./example/src", import.meta.url)),
          },
        },
        test: {
          name: "example-ui",
          include: ["example/src/components/**/*.test.tsx"],
          exclude: ["dist/**", "node_modules/**"],
          environment: "jsdom",
          setupFiles: ["example/src/test/setup.ts"],
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
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.{ts,js,mjs}"],
          exclude: ["dist/**", "node_modules/**"],
        },
      },
    ],
  },
});
