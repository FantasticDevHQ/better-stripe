import { describe, expect, it } from "vitest";

import { epochToIso, extractIdentifiers, jsonResponse } from "./helpers.js";

describe("epochToIso", () => {
  it("converts unix epoch seconds to ISO string", () => {
    // 2024-01-01T00:00:00.000Z = 1704067200
    expect(epochToIso(1704067200)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns undefined for null", () => {
    expect(epochToIso(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(epochToIso(undefined)).toBeUndefined();
  });

  it("handles epoch 0 (Unix epoch start)", () => {
    expect(epochToIso(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("extractIdentifiers", () => {
  it("extracts userId and orgId from metadata", () => {
    const result = extractIdentifiers({
      userId: "user_123",
      orgId: "org_456",
    });
    expect(result.userId).toBe("user_123");
    expect(result.orgId).toBe("org_456");
  });

  it("falls back to snake_case keys", () => {
    const result = extractIdentifiers({
      user_id: "user_snake",
      org_id: "org_snake",
    });
    expect(result.userId).toBe("user_snake");
    expect(result.orgId).toBe("org_snake");
  });

  it("prefers camelCase over snake_case", () => {
    const result = extractIdentifiers({
      userId: "camel",
      user_id: "snake",
    });
    expect(result.userId).toBe("camel");
  });

  it("returns empty string userId for null metadata", () => {
    expect(extractIdentifiers(null).userId).toBe("");
    expect(extractIdentifiers(undefined).userId).toBe("");
  });

  it("returns undefined orgId when not present", () => {
    const result = extractIdentifiers({ userId: "user_123" });
    expect(result.orgId).toBeUndefined();
  });
});

describe("jsonResponse", () => {
  it("creates a Response with JSON body", async () => {
    const res = jsonResponse({ ok: true }, 200);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("uses the provided status code", async () => {
    const res = jsonResponse({ error: "not found" }, 404);
    expect(res.status).toBe(404);
  });
});
