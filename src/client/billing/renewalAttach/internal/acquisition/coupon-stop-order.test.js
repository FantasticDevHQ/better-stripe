// NEW20th controlled counter drift; original19 Source bodies remain unchanged.
import { test } from "vitest";
import assert from "node:assert/strict";
import { createTestOnlyRawAcquisition } from "./test-fixtures/sourcePort.mjs";
import {
  scenario,
  fakeOwner,
  fakeTransport,
} from "./test-fixtures/scenario.mjs";
test("first expanded Coupon drift stops before issuing any successor Coupon GET", async () => {
  const s = scenario();
  s.coupons.get("subscription-offer-0").times_redeemed = 8;
  const owner = fakeOwner(s),
    http = fakeTransport(s, owner),
    reader = createTestOnlyRawAcquisition({ owner, transport: http.transport });
  assert.deepEqual(await reader.acquire(s.expected), {
    ok: false,
    complete: false,
    code: "RAW_ACQUISITION_STOP",
  });
  assert.equal(http.calls.length, 4);
  assert.equal(http.calls[3].path, "/v1/coupons/subscription-offer-0");
});
