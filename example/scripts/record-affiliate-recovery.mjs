import { chromium } from "@playwright/test";
import { mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("../docs/evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 960 },
  recordVideo: { dir: output, size: { width: 1280, height: 960 } },
});
const page = await context.newPage();
await page.goto(
  process.env.AFFILIATE_RECOVERY_URL ??
    "http://127.0.0.1:5173/demo/affiliate-recovery",
);
await page
  .getByRole("heading", { name: "Affiliate commission recovery", exact: true })
  .waitFor();
await page
  .getByText("Simulated accounting fixtures.", { exact: false })
  .waitFor();
for (const scenario of [
  "One-time full refund",
  "Recurring invoice refund",
  "Partial refund and rounding",
  "Open monetary dispute",
  "Lost dispute finalized",
  "Won dispute restored",
  "Refund retained after dispute win",
  "Insufficient balance after external payout",
  "Debt recovered from future commission",
  "Provider timeout awaiting receipt",
]) {
  await page.getByRole("button", { name: scenario, exact: true }).click();
  await page.getByText(scenario, { exact: true }).last().waitFor();
  await page.waitForTimeout(650);
}
await page
  .getByRole("button", { name: "Switch to via API", exact: true })
  .click();
await page.getByText("Outstanding debt", { exact: true }).first().waitFor();
await page.waitForTimeout(1000);
await page.screenshot({
  path: resolve(output, "affiliate-recovery.png"),
  fullPage: true,
});
const video = page.video();
await context.close();
await rename(await video.path(), resolve(output, "affiliate-recovery.webm"));
await browser.close();
process.stdout.write(
  "Recorded simulated recovery scenarios and both reusable presentations.\n",
);
