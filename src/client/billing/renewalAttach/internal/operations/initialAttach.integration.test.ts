import assert from "node:assert/strict";
import { data } from "../test-fixtures/attachScenarioBarriers.js";
import { it } from "vitest";
import { scenario } from "../test-fixtures/attachScenario.js";
it("actual owned initial attach ACK positive", async () => {
  const h = await scenario("INITIAL-ACK");
  try {
    const out = await h.runInitial();
    h.assertInitialAcknowledged(out);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual initial retained predicate truthy nonboolean refuses before HTTP", async () => {
  const h = await scenario("INITIAL-TRUTHY");
  try {
    const out = data(await h.invokeInitial());
    assert.equal(out.status, "not_dispatched");
    assert.equal(out.reason, "retained_class_not_unique");
    assert.equal(out.operationalAuthority, false);
    const predicate = h.retainedPredicateState();
    assert.equal(predicate.retainedCalls, 1);
    assert.equal(predicate.retainedMatches, 1);
    assert.equal(predicate.lastRetainedResult, 1);
    assert.equal(h.effectCounts().GET, 0);
    assert.equal(h.effectCounts().POST, 0);
    assert.equal(h.aRecords().length, 0);
  } finally {
    await h.cleanup();
  }
  h.health();
});
