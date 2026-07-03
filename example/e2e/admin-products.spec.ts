import { expect, test } from "@playwright/test";

/**
 * Admin products: Edit + Deactivate (BTS-59).
 *
 * These flows require a LIVE backend — a linked Convex dev deployment with the
 * Stripe key set, demo data seeded, and webhook event destinations configured
 * (product.updated drives the reactive UI update after an edit/deactivate).
 * That's beyond the harness's backend-independent boundary (see the README's
 * "Browser E2E Tests" section), so the spec runs only with the explicit
 * live-backend opt-in, pointing the harness at a real deployment:
 *
 *   E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=https://<your-dev-deployment>.convex.cloud \
 *     pnpm --filter ./example e2e
 *
 * The spec is self-contained and parallel-safe: it creates its own uniquely
 * named product, edits it, then deactivates it — it never touches seeded data.
 */
const LIVE = !!process.env.E2E_LIVE_BACKEND;

test.describe("admin products — edit & deactivate", () => {
  test.skip(
    !LIVE,
    "Requires a seeded deployment: E2E_LIVE_BACKEND=1 VITE_CONVEX_URL=… (see README)",
  );

  // Unique per run so parallel workers/replays never collide on seeded state.
  const productName = `E2E Product ${Date.now()}`;
  const editedName = `${productName} (edited)`;

  test("edit persists changes and deactivate archives the product", async ({
    page,
  }) => {
    // The admin pages are gated on the demo role stored in localStorage.
    await page.addInitScript(() => {
      localStorage.setItem("betterlearn-role", "admin");
    });
    await page.goto("/admin/products");

    // --- Arrange: create a product this spec owns. -------------------------
    await page.getByRole("button", { name: "Create Product" }).click();
    await page.getByLabel("Name").fill(productName);
    await page.getByLabel("Description").fill("created by e2e");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const row = page.getByRole("row", { name: new RegExp(productName) });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // --- Act 1: edit the product via the Edit dialog. ----------------------
    await row.getByRole("button", { name: "Edit" }).click();
    const nameInput = page.getByLabel("Name");
    await expect(nameInput).toHaveValue(productName); // prefilled from the row
    await nameInput.fill(editedName);
    await page.getByLabel("Description").fill("edited by e2e");
    await page.getByRole("button", { name: "Save" }).click();

    // The table reflects the persisted change once the product.updated webhook
    // syncs the component DB — this asserts real persistence, not local state.
    const editedRow = page.getByRole("row", { name: new RegExp(editedName) });
    await expect(editedRow).toBeVisible({ timeout: 30_000 });
    await expect(editedRow).toContainText("edited by e2e");

    // --- Act 2: deactivate it. ---------------------------------------------
    await editedRow.getByRole("button", { name: "Deactivate" }).click();

    await expect(editedRow).toContainText("Archived", { timeout: 30_000 });
    await expect(
      editedRow.getByRole("button", { name: "Deactivate" }),
    ).toHaveCount(0);
  });
});
