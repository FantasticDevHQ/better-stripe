import { pathToFileURL } from "node:url";

// An access preflight only. A successful response does not establish Accounts v2,
// connected-account, usage ingestion, aggregation or invoice compatibility.
export async function probeMetering({ apiKey, request = fetch }) {
  if (typeof apiKey !== "string" || !/^sk_test_\S+$/.test(apiKey)) {
    throw new Error("A Stripe test-mode secret key is required");
  }
  const response = await request(
    "https://api.stripe.com/v1/billing/meters?limit=1",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Stripe-Version": "2026-09-30.endive",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  // Never print provider bodies, IDs, headers, credentials or error messages.
  await response.body?.cancel();
  return {
    provider: "stripe-billing-meters",
    apiVersion: "2026-09-30.endive",
    observedAt: new Date().toISOString(),
    status: response.status,
    accessible: response.ok,
    accountIdentity: "unverified",
    connectedAccount: "unverified",
    ingestion: "unverified",
    aggregation: "unverified",
    invoicing: "unverified",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await probeMetering({
      apiKey: process.env.STRIPE_SECRET_KEY,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.accessible) process.exitCode = 1;
  } catch {
    console.error(
      "Metering preflight failed. Check test-key injection and network access. No provider details were logged.",
    );
    process.exitCode = 1;
  }
}
