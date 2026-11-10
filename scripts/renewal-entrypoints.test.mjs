import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Vite declares the esbuild peer used by the example's bundler toolchain.
const exampleRequire = createRequire(
  new URL("../example/package.json", import.meta.url),
);
const viteRequire = createRequire(exampleRequire.resolve("vite"));
const { build } = await import(viteRequire.resolve("esbuild"));
const root = fileURLToPath(new URL("..", import.meta.url));

it("bundles the ordinary server SDK for a browser without Node attachment kernels", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/client/index.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    treeShaking: false,
    logLevel: "silent",
    metafile: true,
  });
  expect(
    Object.keys(result.metafile.inputs).some((path) =>
      path.endsWith("producer/ownerFactory.ts"),
    ),
  ).toBe(false);
});

it("includes the maintained attachment engine through the public Node entrypoint", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/client/node.ts"],
    bundle: true,
    packages: "external",
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    metafile: true,
  });
  expect(
    Object.keys(result.metafile.inputs).some((path) =>
      path.endsWith("producer/ownerFactory.ts"),
    ),
  ).toBe(true);
  expect(result.outputFiles).toHaveLength(1);
});
