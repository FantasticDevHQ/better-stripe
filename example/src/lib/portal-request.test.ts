import { expect, it, vi } from "vitest";
import { openRetainedPortal } from "./portal-request";
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const create = vi.fn().mockRejectedValue(new Error("unknown outcome"));
  const prepare = vi.fn(async (key: string) => ({
    key,
    binding: "fixed options",
  }));
  const options = {
    storage,
    namespace: "seller",
    selection: "account/sub/target/return",
    prepare,
    create,
    isCurrent: () => true,
  };
  return { values, options, create, prepare };
}
it("persists the pair before POST and reuses it after an unknown outcome and a new callback", async () => {
  const { values, options, create, prepare } = fixture();
  create.mockImplementation(async (identity) => {
    expect(JSON.parse(values.get("seller")!)).toMatchObject({ identity });
    throw new Error("unknown outcome");
  });
  await expect(openRetainedPortal(options)).rejects.toThrow("unknown outcome");
  const identity = create.mock.calls[0]![0];
  await expect(openRetainedPortal({ ...options })).rejects.toThrow(
    "unknown outcome",
  );
  expect(create.mock.calls[1]![0]).toEqual(identity);
  expect(prepare).toHaveBeenCalledOnce();
});
it("retains the first key if preparation fails, without a POST", async () => {
  const { options, prepare, create } = fixture();
  prepare.mockRejectedValueOnce(new Error("lost response"));
  await expect(openRetainedPortal(options)).rejects.toThrow("lost response");
  await expect(openRetainedPortal(options)).rejects.toThrow("unknown outcome");
  expect(prepare.mock.calls[0]).toEqual(prepare.mock.calls[1]);
  expect(create).toHaveBeenCalledOnce();
});
it.each(["selection", "expired", "corrupt", "unavailable", "stale"])(
  "stops %s before POST without replacing a saved operation",
  async (reason) => {
    const { values, options, create } = fixture();
    await expect(openRetainedPortal(options)).rejects.toThrow();
    create.mockClear();
    const saved = values.get("seller")!;
    if (reason === "selection") options.selection = "changed";
    if (reason === "expired")
      values.set(
        "seller",
        JSON.stringify({ ...JSON.parse(saved), createdAt: 0 }),
      );
    if (reason === "corrupt") values.set("seller", "{}");
    if (reason === "unavailable")
      options.storage.setItem = () => {
        throw new Error("storage blocked");
      };
    if (reason === "stale") options.isCurrent = () => false;
    const before = values.get("seller");
    await expect(openRetainedPortal(options)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    if (reason !== "stale") expect(values.get("seller")).toBe(before);
  },
);
it("supersedes an older preparation without dispatching its POST", async () => {
  const { options, prepare, create } = fixture();
  let resolve!: (value: { key: string; binding: string }) => void;
  prepare.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const old = openRetainedPortal(options);
  await expect(openRetainedPortal({ ...options })).rejects.toThrow(
    "unknown outcome",
  );
  resolve({ key: prepare.mock.calls[0]![0], binding: "fixed options" });
  await expect(old).rejects.toThrow("changed");
  expect(create).toHaveBeenCalledOnce();
});
