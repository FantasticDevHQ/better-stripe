import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const files = [
  ...new Set(
    execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        "README.md",
        "MIGRATION.md",
        "example/README.md",
        "docs/*.md",
        "docs/**/*.md",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean),
  ),
];
const documents = files.map((file) => ({
  file,
  text: readFileSync(file, "utf8"),
}));

it("resolves documented package imports and server reference methods against built public declarations", () => {
  const paths = {
    root: "dist/client/index.d.ts",
    react: "dist/react/index.d.ts",
    usage: "dist/client/usage/index.d.ts",
    testing: "dist/testing/index.d.ts",
  };
  const program = ts.createProgram(Object.values(paths), {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const modules = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => {
      const source = program.getSourceFile(path);
      expect(
        source,
        "Build the package before checking documented exports",
      ).toBeTruthy();
      return [
        name,
        checker.getExportsOfModule(checker.getSymbolAtLocation(source)),
      ];
    }),
  );
  const failures = [];
  for (const { file, text } of documents) {
    for (const match of text.matchAll(
      /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@fantastic\.dev\/better-stripe(?:\/(react|usage|testing))?["']/g,
    )) {
      const names = new Set(
        modules[match[2] ?? "root"].map((symbol) => symbol.name),
      );
      for (const raw of match[1].replace(/\/\/[^\n]*/g, "").split(",")) {
        const name = raw
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (name && !names.has(name))
          failures.push(`${file}: missing export ${name}`);
      }
    }
  }
  const client = checker.getDeclaredTypeOfSymbol(
    modules.root.find((symbol) => symbol.name === "BetterStripe"),
  );
  const methods = new Set(client.getProperties().map((symbol) => symbol.name));
  const reference = documents.find(
    ({ file }) => file === "docs/client-api.md",
  ).text;
  for (const match of reference.matchAll(/^\|\s*`([A-Za-z]+)\(/gm)) {
    if (!methods.has(match[1]))
      failures.push(`Server reference: missing method ${match[1]}`);
  }
  expect(failures).toEqual([]);
});

function anchors(text) {
  const occurrences = new Map();
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) => {
      const base = heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\- ]/gu, "")
        .replaceAll(" ", "-");
      const previous = occurrences.get(base) ?? 0;
      occurrences.set(base, previous + 1);
      return previous ? `${base}-${previous}` : base;
    }),
  );
}

it("keeps local documentation files and heading links valid", () => {
  const failures = [];
  for (const { file, text } of documents) {
    const prose = text.replace(/```[\s\S]*?```/g, "");
    for (const [, raw] of prose.matchAll(
      /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const href = raw.replace(/^<|>$/g, "");
      if (/^(?:[a-z]+:|\/)/i.test(href)) continue;
      const [path, fragment] = href.split("#");
      const target = path
        ? resolve(dirname(file), decodeURIComponent(path))
        : resolve(file);
      if (!existsSync(target)) failures.push(`${file}: missing ${href}`);
      else if (
        fragment &&
        target.endsWith(".md") &&
        !anchors(readFileSync(target, "utf8")).has(decodeURIComponent(fragment))
      ) {
        failures.push(`${file}: missing heading ${href}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
