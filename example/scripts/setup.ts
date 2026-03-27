/**
 * Setup script for the better-stripe example app.
 *
 * Reads STRIPE_SECRET_KEY from .env.local and sets it as a Convex env var.
 * This is the only setup step that requires CLI access — everything else
 * (webhooks, seeding, syncing) can be done from the Admin UI at /admin/setup.
 *
 * Usage: npm run setup
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Load .env.local from the example directory
const envPath = resolve(import.meta.dirname, "..", ".env.local");
config({ path: envPath });

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY not found in .env.local");
  console.error("   Get your key from https://dashboard.stripe.com/apikeys");
  process.exit(1);
}

const exampleDir = resolve(import.meta.dirname, "..");

function mask(value: string): string {
  if (value.length <= 12) return "***";
  return `${value.slice(0, 8)}...`;
}

function convexEnvSet(name: string, value: string): void {
  const args = ["convex", "env", "set", name, value];
  console.log(`  $ npx convex env set ${name} ${mask(value)}`);
  try {
    execFileSync("npx", args, { cwd: exampleDir, encoding: "utf-8" });
  } catch {
    // Already exists — remove and re-set
    try {
      execFileSync("npx", ["convex", "env", "remove", name], {
        cwd: exampleDir,
        encoding: "utf-8",
      });
    } catch {
      // May not exist
    }
    execFileSync("npx", args, { cwd: exampleDir, encoding: "utf-8" });
  }
}

function main() {
  console.log("\n🔧 better-stripe example — Setup\n");

  // ─── Set STRIPE_SECRET_KEY in Convex ────────────────────────────────
  console.log("Setting STRIPE_SECRET_KEY in Convex environment...");
  convexEnvSet("STRIPE_SECRET_KEY", STRIPE_SECRET_KEY!);
  console.log("   ✅ Done\n");

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("🎉 Stripe key configured!\n");
  console.log("   Next steps:");
  console.log("     1. npm run dev");
  console.log("     2. Go to /admin/setup to complete the rest:");
  console.log("        - Set up webhook destinations");
  console.log("        - Seed demo data");
  console.log("        - Sync existing Stripe data");
  console.log("");
}

main();
