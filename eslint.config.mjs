import convexPlugin from "@convex-dev/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { dirname } from "path";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  {
    ignores: ["dist", "src/component/_generated/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  // Convex-specific rules for the component source (Convex backend functions).
  // The plugin's built-in "recommended" preset targets `**/convex/**/*.ts`, but
  // this project keeps its Convex component at `src/component/`, so we apply
  // the rules directly with the correct file glob.
  {
    files: ["src/component/**/*.ts"],
    ignores: ["src/component/_generated/**", "src/component/**/*.test.ts"],
    plugins: {
      "@convex-dev": convexPlugin,
    },
    rules: {
      "@convex-dev/no-old-registered-function-syntax": "error",
      "@convex-dev/require-args-validator": "error",
      "@convex-dev/explicit-table-ids": "error",
      "@convex-dev/no-collect-in-query": "error",
    },
  },
];
