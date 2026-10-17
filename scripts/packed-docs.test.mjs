import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
it("ships every local Markdown guide reachable from the public README and migration guide in the actual tarball", () => {
  const destination = mkdtempSync(
    resolve(tmpdir(), "better-stripe-packed-docs-"),
  );
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", destination], {
      cwd: root,
      stdio: "pipe",
    });
    const archive = readdirSync(destination).find((name) =>
      name.endsWith(".tgz"),
    );
    expect(archive).toBeTruthy();
    const packed = new Set(
      execFileSync("tar", ["-tzf", resolve(destination, archive)], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .map((path) => path.replace(/^package\//, "")),
    );
    const pending = ["README.md", "MIGRATION.md"],
      visited = new Set();
    while (pending.length) {
      const document = pending.pop();
      if (visited.has(document)) continue;
      visited.add(document);
      expect(
        packed.has(document),
        `Public guide missing from packed artifact: ${document}`,
      ).toBe(true);
      const markdown = readFileSync(resolve(root, document), "utf8");
      for (const [, raw] of markdown.matchAll(
        /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      )) {
        const href = raw.replace(/^<|>$/g, "").split("#")[0];
        if (!href || /^(?:[a-z]+:|\/)/i.test(href) || !href.endsWith(".md"))
          continue;
        const target = resolve(
          dirname(resolve(root, document)),
          decodeURIComponent(href),
        );
        const path = relative(root, target).split(posix.sep).join("/");
        expect(
          path.startsWith(".."),
          `Guide escapes package: ${document} -> ${href}`,
        ).toBe(false);
        pending.push(path);
      }
    }
    expect(visited.size).toBeGreaterThan(10);
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});
