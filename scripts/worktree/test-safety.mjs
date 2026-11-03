import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function assertExternalTmpdir(directory = tmpdir()) {
  let current = realpathSync(directory);
  while (true) {
    if (
      existsSync(path.join(current, ".git")) ||
      existsSync(path.join(current, "scripts/worktree.config.json"))
    )
      throw new Error(
        "Worktree fixture TMPDIR must be outside every Git checkout and worktree layout.",
      );
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

assertExternalTmpdir();
