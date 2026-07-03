import convexPlugin from "@convex-dev/eslint-plugin";
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "convex/_generated", "src/components/ui"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Node CLI scripts (tsx) — same TS rules as above, but with Node globals
  // instead of browser globals.
  {
    files: ["scripts/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Playwright E2E harness — runs in Node (reads process.env, no React refresh).
  {
    files: ["playwright.config.ts", "e2e/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  // Convex-specific rules for example/convex. The plugin's "recommended" preset
  // targets **/convex/**/*.ts which matches this directory automatically.
  ...convexPlugin.configs.recommended,
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/_generated/**", "convex/**/*.test.ts"],
    rules: {
      "@convex-dev/no-collect-in-query": "error",
    },
  },
]);
