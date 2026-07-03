import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E harness for the example app (BTS-56).
 *
 * Scope: prove the example app boots and renders in a real browser. The harness
 * deliberately does NOT depend on a live Convex/Stripe backend — CI has no
 * secrets and no deployment is provisioned here. The app is served by its Vite
 * dev server with a placeholder Convex URL, so data-backed areas stay in their
 * loading/empty state. Data-dependent demo flows (BTS-57/58/59/44/42/43/46) will
 * stand up a seeded Convex + Stripe test environment separately; that is out of
 * scope for this foundation.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // A syntactically valid placeholder so the Convex client constructs without
    // throwing even when no backend is configured (no .env.local). The socket
    // never connects; queries stay pending and the app shows its loading state —
    // exactly the backend-independent surface this harness verifies. Anything
    // already exported in the environment wins, so a developer with a real local
    // deployment can point the harness at it via VITE_CONVEX_URL.
    //
    // NOTE: the deployment-name portion must match Convex's real
    // `adjective-animal-number` format — convex-js ≥1.41 fatally rejects
    // malformed names at client construction (surfaces as a page error and
    // breaks the always-run boot layer), so a bare name like "e2e-harness" no
    // longer works.
    env: {
      VITE_CONVEX_URL:
        process.env.VITE_CONVEX_URL ?? "https://placeholder-otter-123.convex.cloud",
    },
  },
});
