import schema from "./component/schema";

export { schema };

// Load Convex functions during fixture import so the first action does not
// spend its execution timeout compiling the function graph.
const functionModules = import.meta.glob(
  [
    "./component/**/*.ts",
    "!./component/**/*.test.*",
    "!./component/**/*.fixtures.ts",
    "!./component/**/convex.config.*",
  ],
  { eager: true },
);
export const modules = Object.fromEntries(
  Object.entries(functionModules).map(([path, module]) => [
    path,
    () => Promise.resolve(module),
  ]),
);
