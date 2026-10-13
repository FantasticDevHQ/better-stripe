import { describe, expect, it } from "vitest";
import { canVisit, type Role } from "./role-navigation";

describe("direct finance page access", () => {
  for (const role of [
    "visitor",
    "customer",
    "seller",
    "affiliate",
    "admin",
  ] as Role[]) {
    it(`keeps ${role} on its own finance pages`, () => {
      expect(canVisit(role, "/dashboard/billing")).toBe(role === "customer");
      expect(canVisit(role, "/demo/store-earnings")).toBe(role === "seller");
      expect(canVisit(role, "/demo/subscribe")).toBe(role === "seller");
      expect(canVisit(role, "/affiliate")).toBe(role === "affiliate");
      expect(canVisit(role, "/admin/setup")).toBe(role === "admin");
      expect(canVisit(role, "/stores")).toBe(true);
      expect(canVisit(role, "/checkout")).toBe(
        role === "customer" || role === "visitor",
      );
    });
  }
});
