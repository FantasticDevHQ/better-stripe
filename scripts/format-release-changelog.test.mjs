import { describe, expect, it, vi } from "vitest";
import { formatReleaseChangelog } from "./format-release-changelog.mjs";

const repository = "FantasticDevHQ/better-stripe";
const branch =
  "release-please--branches--main--components--@fantastic.dev/better-stripe";
const raw =
  "## [0.8.1](https://example.com/compare) (2026-10-13)\n\n\n### Bug Fixes\n\n* fix example\n";
const formatted = raw.replace("\n\n\n", "\n\n").replace("* fix", "- fix");
const pr = () => ({
  state: "open",
  base: { ref: "main" },
  head: { ref: branch, repo: { full_name: repository } },
});
function setup(content = raw, pullRequest = pr()) {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(pullRequest)))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sha: "original-blob",
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
        }),
      ),
    )
    .mockResolvedValueOnce(new Response("{}"));
  return {
    request,
    run: () =>
      formatReleaseChangelog({
        repository,
        prNumber: 136,
        token: "test-token",
        request,
      }),
  };
}
describe("formatReleaseChangelog", () => {
  it("formats generated markdown and commits only the changelog on the release branch", async () => {
    const { request, run } = setup();
    expect(await run()).toBe(true);
    const [url, options] = request.mock.calls[2];
    expect(url).toBe(
      `https://api.github.com/repos/${repository}/contents/CHANGELOG.md`,
    );
    const update = JSON.parse(options.body);
    expect(options.method).toBe("PUT");
    expect(update.sha).toBe("original-blob");
    expect(update.branch).toBe(branch);
    expect(Buffer.from(update.content, "base64").toString()).toBe(formatted);
  });
  it("does not create another commit when formatting is already correct", async () => {
    const { request, run } = setup(formatted);
    expect(await run()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not write to a closed release PR", async () => {
    const { request, run } = setup(raw, { ...pr(), state: "closed" });
    expect(await run()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...pr(), head: { ...pr().head, repo: { full_name: "other/repo" } } },
    { ...pr(), head: { ...pr().head, ref: "main" } },
    { ...pr(), base: { ref: "develop" } },
  ])(
    "rejects a PR outside the generated same-repository release branch",
    async (pullRequest) => {
      const { request, run } = setup(raw, pullRequest);
      await expect(run()).rejects.toThrow("release PR");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("fails on a concurrent update instead of overwriting it", async () => {
    const { request, run } = setup();
    request
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify(pr())))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "original-blob",
            encoding: "base64",
            content: Buffer.from(raw).toString("base64"),
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("conflict", { status: 409 }));
    await expect(run()).rejects.toThrow("409");
    expect(request).toHaveBeenCalledTimes(3);
  });
});
