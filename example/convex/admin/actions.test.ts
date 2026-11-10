import { modules } from "../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * The Admin Setup page's public actions: the live-key refusal on the
 * destructive ones, and the environment report (including the publishable key
 * the browser reads through Convex).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stripe/helpers", () => ({
  stripe: { clearAll: vi.fn() },
}));

import { convexEnvVarsToSet } from "../../scripts/setup-env";
import { api } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";

const ENV_NAMES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET_V2",
] as const;
const original = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ENV_NAMES) delete process.env[name];
});
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

async function seedUser(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Maya",
      email: "maya@example.com",
      role: "seller",
    }),
  );
}
const userCount = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => (await ctx.db.query("users").collect()).length);

describe("admin actions — refuse a live or malformed Stripe key", () => {
  it.each(["sk_live_should_never_run", "rk_live_should_never_run", "nonsense"])(
    "resetAll deletes nothing when the key is %s",
    async (key) => {
      process.env.STRIPE_SECRET_KEY = key;
      const t = convexTest(schema, modules);
      await seedUser(t);

      await expect(t.action(api.admin.actions.resetAll, {})).rejects.toThrow(
        /test-mode key/,
      );
      expect(stripe.clearAll).not.toHaveBeenCalled();
      expect(await userCount(t)).toBe(1);
    },
  );

  it("seedDemoData writes nothing when the key is live", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);

    await expect(t.action(api.admin.actions.seedDemoData, {})).rejects.toThrow(
      /test-mode key/,
    );
    expect(await userCount(t)).toBe(0);
  });

  it("resetAll clears both databases with a test-mode key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_admin_actions";
    vi.mocked(stripe.clearAll).mockResolvedValue({
      cleared: 0,
      tables: [],
    } as never);
    const t = convexTest(schema, modules);
    await seedUser(t);

    await expect(t.action(api.admin.actions.resetAll, {})).resolves.toBeNull();
    expect(stripe.clearAll).toHaveBeenCalledTimes(1);
    expect(await userCount(t)).toBe(0);
  });
});

describe("admin actions — checkEnvVars", () => {
  it("reports each variable, including the publishable key", async () => {
    const t = convexTest(schema, modules);
    expect(await t.action(api.admin.actions.checkEnvVars, {})).toEqual({
      stripeSecretKey: false,
      stripePublishableKey: false,
      webhookSecret: false,
      webhookSecretV2: false,
    });

    process.env.STRIPE_SECRET_KEY = "sk_test_admin_actions";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_admin_actions";
    expect(await t.action(api.admin.actions.checkEnvVars, {})).toEqual({
      stripeSecretKey: true,
      stripePublishableKey: true,
      webhookSecret: false,
      webhookSecretV2: false,
    });
  });
});

describe("setup script — which .env.local keys reach Convex", () => {
  it("copies the secret and publishable keys", () => {
    expect(
      convexEnvVarsToSet({
        STRIPE_SECRET_KEY: "sk_test_1",
        STRIPE_PUBLISHABLE_KEY: " pk_test_1 ",
        VITE_CONVEX_URL: "https://example.convex.cloud",
      }),
    ).toEqual([
      { name: "STRIPE_SECRET_KEY", value: "sk_test_1" },
      { name: "STRIPE_PUBLISHABLE_KEY", value: "pk_test_1" },
    ]);
  });

  it("skips a blank or missing publishable key", () => {
    expect(
      convexEnvVarsToSet({
        STRIPE_SECRET_KEY: "sk_test_1",
        STRIPE_PUBLISHABLE_KEY: "",
      }),
    ).toEqual([{ name: "STRIPE_SECRET_KEY", value: "sk_test_1" }]);
    expect(convexEnvVarsToSet({})).toEqual([]);
  });
});
