// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Unit coverage for the generic `assertOwnership` gate (BTS-83). The
 * resource-specific wrappers (`assertSubscriptionOwner`, `assertDisputeOwner`,
 * etc.) are exercised end to end through the actions that call them in
 * `actions.actions.test.ts` — this file only covers the shared primitive
 * itself: actor-id validation and the not-found/wrong-owner collapse.
 */
import { describe, expect, it, vi } from "vitest";

import type { ActionCtx } from "./_generated/server";
import { assertOwnership } from "./authz";

const fakeCtx = {} as ActionCtx;

describe("assertOwnership (BTS-83 generic ownership gate)", () => {
  it("rejects a blank actorId before calling the resource lookup", async () => {
    const loadOwnedResource = vi.fn();

    await expect(
      assertOwnership(fakeCtx, "", loadOwnedResource, "not found"),
    ).rejects.toThrow("actorId is required");
    expect(loadOwnedResource).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only actorId before calling the resource lookup", async () => {
    const loadOwnedResource = vi.fn();

    await expect(
      assertOwnership(fakeCtx, "   ", loadOwnedResource, "not found"),
    ).rejects.toThrow("actorId is required");
    expect(loadOwnedResource).not.toHaveBeenCalled();
  });

  it("throws the caller's not-found message when the lookup returns null", async () => {
    const loadOwnedResource = vi.fn().mockResolvedValue(null);

    await expect(
      assertOwnership(fakeCtx, "user_1", loadOwnedResource, "Widget not found for this user"),
    ).rejects.toThrow("Widget not found for this user");
    expect(loadOwnedResource).toHaveBeenCalledWith(fakeCtx, "user_1");
  });

  it("returns the resource when the lookup confirms ownership", async () => {
    const resource = { id: "widget_1" };
    const loadOwnedResource = vi.fn().mockResolvedValue(resource);

    await expect(
      assertOwnership(fakeCtx, "user_1", loadOwnedResource, "not found"),
    ).resolves.toBe(resource);
  });
});
