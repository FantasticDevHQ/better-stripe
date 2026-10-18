import assert from "node:assert/strict";
const [stage, suffix, sharing] = process.argv.slice(2);
const url = process.env.CONVEX_SELF_HOSTED_URL;
const key = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
const instance = process.env.BTS_NATIVE_INSTANCE;
assert(
  url && key && instance,
  "Explicit isolated backend URL, admin key and BTS_NATIVE_INSTANCE are required.",
);
assert(
  new URL(url).hostname === "127.0.0.1" ||
    new URL(url).hostname === "localhost",
  "Only an explicitly selected localhost test backend is allowed.",
);
assert(
  suffix && /^[a-zA-Z0-9_]+$/.test(suffix),
  "Supply a synthetic fixture suffix.",
);
assert.equal(await (await fetch(`${url}/instance_name`)).text(), instance);
const shared = sharing === "shared";
async function request(kind, path, args) {
  const body =
    kind === "function"
      ? {
          componentPath: "betterStripe",
          path,
          format: "convex_encoded_json",
          args,
        }
      : { path, format: "convex_encoded_json", args: [args] };
  return (
    await fetch(`${url}/api/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${key}`,
      },
      body: JSON.stringify(body),
    })
  ).json();
}
async function success(kind, path, args) {
  const result = await request(kind, path, args);
  assert.equal(result.status, "success", JSON.stringify(result));
  return result.value;
}
async function verify(risk) {
  for (let start = 0; start < 1000; start += 25) {
    const v = await success("query", "capacity230:verify", {
      suffix,
      start,
      count: 25,
      frontier: 0,
      shared,
      expectedRisk: risk,
    });
    assert.equal(v.operationPresent, false);
  }
}
if (stage === "seed") {
  for (let start = 0; start < 1000; start += 25)
    await success("mutation", "capacity230:seed", {
      suffix,
      start,
      count: 25,
      shared,
    });
} else if (stage === "baseline") {
  assert.equal(
    shared,
    false,
    "The regression baseline requires 1,000 distinct destinations.",
  );
  const result = await request("mutation", "capacity230:claim", { suffix });
  assert.equal(result.status, "error");
  assert.match(result.errorMessage, /Too many (reads|database queries)/i);
  await verify(0);
} else if (stage === "activate") {
  for (let i = 0; i < (shared ? 4 : 1000); i++) {
    const result = await success(
      "function",
      "payoutRevisionJournal/mutations:activateAccount",
      { accountId: `capacity230_${suffix}_${i}` },
    );
    assert(["activated", "unchanged"].includes(result.status));
  }
} else if (stage === "candidate") {
  const first = await success("mutation", "capacity230:claim", { suffix });
  assert.equal(first.replay, false);
  assert.equal(first.count, 1000);
  console.log(JSON.stringify({ step: "firstClaim", suffix, result: first }));
  const replay = await success("mutation", "capacity230:claim", { suffix });
  assert.equal(replay.replay, true);
  assert.equal(replay.count, 1000);
  console.log(
    JSON.stringify({ step: "matchingReplay", suffix, result: replay }),
  );
  const release = await success("mutation", "capacity230:release", { suffix });
  assert.equal(release.released, true);
  assert.equal(release.count, 1000);
  console.log(JSON.stringify({ step: "release", suffix, result: release }));
  await verify(shared ? 250 : 1);
} else if (stage === "release") {
  const release = await success("mutation", "capacity230:release", { suffix });
  assert.equal(release.released, true);
  assert.equal(release.count, 1000);
  console.log(
    JSON.stringify({ step: "quietReleaseRecovery", suffix, result: release }),
  );
  await verify(shared ? 250 : 1);
} else
  throw new Error(
    "Stage must be seed, baseline, activate, candidate or release.",
  );
console.log(
  JSON.stringify({
    stage,
    suffix,
    shared,
    instance,
    status: "passed",
    providerCalls: 0,
  }),
);
