/**
 * Setup script for the better-stripe example app.
 *
 * Reads env vars from .env.local, then:
 * 1. Sets STRIPE_SECRET_KEY as a Convex env var
 * 2. Calls the `setup:ensureWebhook` Convex action to create/replace a Stripe webhook
 * 3. Sets the returned STRIPE_WEBHOOK_SECRET as a Convex env var
 *
 * Usage: npm run setup
 */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Load .env.local from the example directory
const envPath = resolve(import.meta.dirname, '..', '.env.local');
config({ path: envPath });

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const CONVEX_SITE_URL = process.env.VITE_CONVEX_SITE_URL;

if (!STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY not found in .env.local');
  process.exit(1);
}

if (!CONVEX_SITE_URL) {
  console.error('❌ VITE_CONVEX_SITE_URL not found in .env.local');
  console.error('   Run `npx convex dev` first to provision your deployment.');
  process.exit(1);
}

const exampleDir = resolve(import.meta.dirname, '..');

function mask(value: string): string {
  if (value.length <= 12) return '***';
  return `${value.slice(0, 8)}...`;
}

function convexEnvSet(name: string, value: string): void {
  const args = ['convex', 'env', 'set', name, value];
  console.log(`  $ npx convex env set ${name} ${mask(value)}`);
  try {
    execFileSync('npx', args, { cwd: exampleDir, encoding: 'utf-8' });
  } catch {
    // Already exists — remove and re-set
    try {
      execFileSync('npx', ['convex', 'env', 'remove', name], {
        cwd: exampleDir,
        encoding: 'utf-8',
      });
    } catch {
      // May not exist
    }
    execFileSync('npx', args, { cwd: exampleDir, encoding: 'utf-8' });
  }
}

function convexRun(fn: string, argsJson: string): string {
  const args = ['convex', 'run', fn, argsJson];
  console.log(`  $ npx convex run ${fn}`);
  return execFileSync('npx', args, {
    cwd: exampleDir,
    encoding: 'utf-8',
  }).trim();
}

function main() {
  console.log('\n🔧 better-stripe example — Setup\n');

  // ─── Step 1: Set STRIPE_SECRET_KEY in Convex ─────────────────────────
  console.log('1️⃣  Setting STRIPE_SECRET_KEY in Convex environment...');
  convexEnvSet('STRIPE_SECRET_KEY', STRIPE_SECRET_KEY!);
  console.log('   ✅ Done\n');

  // ─── Step 2: Ensure webhook via Convex action ────────────────────────
  console.log('2️⃣  Ensuring Stripe webhook endpoint exists...');
  console.log(`   Site URL: ${CONVEX_SITE_URL}`);

  const rawOutput = convexRun(
    'setup:ensureWebhook',
    JSON.stringify({ siteUrl: CONVEX_SITE_URL }),
  );

  // npx convex run prints log lines then the return value as pretty-printed JSON.
  // Extract the JSON object by finding the first '{' and last '}' in output.
  const jsonStart = rawOutput.indexOf('{');
  const jsonEnd = rawOutput.lastIndexOf('}');
  let result: {
    id: string;
    url: string;
    secret: string;
    replaced: boolean;
  } | null = null;

  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      result = JSON.parse(rawOutput.slice(jsonStart, jsonEnd + 1));
    } catch {
      // Fall through to error
    }
  }

  if (!result?.id || !result?.secret) {
    console.error('❌ Failed to parse ensureWebhook output:', rawOutput);
    process.exit(1);
  }

  console.log(`   ${result.replaced ? 'Replaced' : 'Created'}: ${result.id}`);
  console.log(`   URL: ${result.url}`);
  console.log(`   Secret: ${mask(result.secret)}\n`);

  // ─── Step 3: Set STRIPE_WEBHOOK_SECRET in Convex ─────────────────────
  console.log('3️⃣  Setting STRIPE_WEBHOOK_SECRET in Convex environment...');
  convexEnvSet('STRIPE_WEBHOOK_SECRET', result.secret);
  console.log('   ✅ Done\n');

  // ─── Step 4: Seed demo data (users, courses, Stripe products/prices) ─
  console.log(
    '4️⃣  Seeding demo data (users, courses, Stripe products & prices)...',
  );
  try {
    convexRun('seed:run', '{}');
    console.log('   ✅ Done\n');
  } catch (e) {
    // seed:run logs "Already seeded" and still succeeds — only real errors matter
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Already seeded')) {
      console.log('   ✅ Already seeded — skipping\n');
    } else {
      console.error('   ⚠️  Seed failed (non-fatal):', msg);
      console.log('   You can retry later: npx convex run seed:run\n');
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log('🎉 Setup complete!\n');
  console.log('   Convex env vars:');
  console.log('     STRIPE_SECRET_KEY       ✅');
  console.log('     STRIPE_WEBHOOK_SECRET   ✅');
  console.log('');
  console.log('   Stripe webhook:');
  console.log(`     ${result.url}`);
  console.log(
    `     ${result.replaced ? '(replaced existing)' : '(newly created)'}`,
  );
  console.log('');
  console.log('   Next step:');
  console.log('     npm run dev    # Start the app');
  console.log('');
}

main();
