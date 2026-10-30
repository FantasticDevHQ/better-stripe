import { vi } from "vitest";

/** One declared stock SDK GET failure. No real network is used. */
export function installReadRejection(expectedURL: string) {
  const calls: {
    url: string;
    method: string | undefined;
    redirect: RequestRedirect | undefined;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, redirect: init?.redirect });
      throw Object.assign(Error("SYNTHETIC_OWNED_READ_FAILURE"), {
        code: "ECONNRESET",
      });
    },
  );
  return { calls, expectedURL };
}
