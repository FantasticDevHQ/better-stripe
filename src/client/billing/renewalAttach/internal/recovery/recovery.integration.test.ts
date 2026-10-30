import { it } from "vitest";
import assert from "node:assert/strict";
import { scenario } from "../test-fixtures/attachScenario.js";
import { data } from "../test-fixtures/attachScenarioBarriers.js";

it("actual owned explicit recovery G01-scalar", async () => {
  const h = await scenario("G01-scalar");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    h.assertAcknowledged(out);
    h.assertBInnerOwnership();
    h.assertWholeMetrics();
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G02-expanded", async () => {
  const h = await scenario("G02-expanded");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    h.assertAcknowledged(out);
    assert.equal(typeof data(out.observation).schedule, "object");
    assert.equal(data(out.observation).conflict, true);
    h.assertBInnerOwnership();
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G03-consumed", async () => {
  const h = await scenario("G03-consumed");
  try {
    await h.runInitial();
    const captured = await h.captureB();
    const out = await captured.invoke();
    h.assertAcknowledged(out);
    const before = h.effectCounts();
    const second = await captured.invoke();
    assert.equal(data(second).reason, "invocation_consumed");
    assert.deepEqual(h.effectCounts(), before);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G04-entry", async () => {
  const h = await scenario("G04-entry");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    assert.equal(out.status, "not_dispatched");
    assert.equal(out.reason, "replay_coverage_missing");
    assert.equal(h.bPosts(), 0);
    assert.equal(h.bGetCount(), 0);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G05-record", async () => {
  const h = await scenario("G05-record");
  try {
    await h.runInitial();
    await assert.rejects(h.invokeB(), { message: "INITIAL_ACTOR_STOP" });
    assert.equal(h.bPosts(), 0);
    assert.equal(h.bGetCount(), 0);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G06-current", async () => {
  const h = await scenario("G06-current");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    assert.equal(out.status, "not_dispatched");
    assert.equal(out.reason, "replay_material_unsupported");
    assert.equal(h.bPosts(), 0);
    assert.equal(h.bRecords().length, 0);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("SAME original Owner retirement at actual B ACK boundary", async () => {
  const h = await scenario("G07-ACK");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_ACK", observed);
      h.OWNER.retire();
      const outcome = await observed;
      assert(
        outcome.ok === false || outcome.value.status === "fulfilled_unverified",
      );
      assert.equal(h.bPosts(), 0);
      assert(h.bRecords().length < 3);
    } finally {
      h.release("B_ACK");
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("SAME original Owner retirement at actual B C10 boundary", async () => {
  const h = await scenario("G07-C10");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_DIGEST", observed);
      h.OWNER.retire();
      const outcome = await observed;
      assert(
        outcome.ok === false || outcome.value.status === "fulfilled_unverified",
      );
      assert.equal(h.bPosts(), 0);
      assert(h.bRecords().length < 3);
    } finally {
      h.release("B_DIGEST");
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("SAME original Owner retirement at actual B C2 boundary", async () => {
  const h = await scenario("G07-C2");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_DIGEST", observed);
      h.OWNER.retire();
      const outcome = await observed;
      assert(
        outcome.ok === false || outcome.value.status === "fulfilled_unverified",
      );
      assert.equal(h.bPosts(), 0);
      assert(h.bRecords().length < 3);
    } finally {
      h.release("B_DIGEST");
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("SAME original Owner retirement at actual B C3 boundary", async () => {
  const h = await scenario("G07-C3");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_DIGEST", observed);
      h.OWNER.retire();
      const outcome = await observed;
      assert(
        outcome.ok === false || outcome.value.status === "fulfilled_unverified",
      );
      assert.equal(h.bPosts(), 1);
      assert(h.bRecords().length < 3);
    } finally {
      h.release("B_DIGEST");
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("SAME original Owner retirement at actual B GET boundary", async () => {
  const h = await scenario("G07-GET");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_GET", observed);
      h.OWNER.retire();
      const outcome = await observed;
      assert(
        outcome.ok === false || outcome.value.status === "fulfilled_unverified",
      );
      assert.equal(h.bPosts(), 0);
      assert(h.bRecords().length < 3);
    } finally {
      h.release("B_GET");
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("SAME original Owner retirement at actual B replay boundary", async () => {
  const h = await scenario("G07-replay");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_DIGEST", observed);
      h.OWNER.retire();
      const outcome = await observed;
      assert(
        outcome.ok === false || outcome.value.status === "fulfilled_unverified",
      );
      assert.equal(h.bPosts(), 0);
      assert(h.bRecords().length < 3);
    } finally {
      h.release("B_DIGEST");
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("retirement at result observer before final Owner gate preserves opaque uncertainty", async () => {
  const h = await scenario("G07-result");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    assert.equal(out.status, "fulfilled_unverified");
    assert.equal(h.bRecords().length, 3);
    assert.equal(h.c3Entries(), 1);
    assert(Object.prototype.hasOwnProperty.call(out, "quarantine"));
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G07-retire", async () => {
  const h = await scenario("G07-retire");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_DIGEST", observed);
      h.OWNER.retire();
      const out = await observed;
      assert.equal(out.ok, false);
      assert(!out.ok);
      assert.equal(h.bPosts(), 0);
      assert.equal(h.bGetCount(), 0);
    } finally {
      h.release("B_DIGEST");
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G08-ack", async () => {
  const h = await scenario("G08-ack");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_ACK", observed);
      const record = h.bRecords()[0];
      assert.equal(record.binding, h.aRecords()[0].binding);
      h.oldAck({ sequence: record.sequence, binding: record.binding });
      assert.equal(h.bPosts(), 0);
      h.releaseAck();
      const out = await observed;
      assert.equal(out.ok, true);
      assert(out.ok);
      h.assertAcknowledged(out.value);
    } finally {
      h.releaseAck();
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G09-q", async () => {
  const h = await scenario("G09-q");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_GET", observed);
      assert(h.aQuarantine);
      assert.equal(h.controlB().takePostQuarantine(h.aQuarantine), null);
      assert.equal(h.pairB().capability.consumePostCatch(h.aReply), null);
      h.release("B_GET");
      const out = await observed;
      assert.equal(out.ok, true);
      assert(out.ok);
      h.assertAcknowledged(out.value);
    } finally {
      h.release("B_GET");
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G10-delivery", async () => {
  const h = await scenario("G10-delivery");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_DIGEST", observed);
      h.mutateUnusedDelivery();
      h.release("B_DIGEST");
      const out = await observed;
      assert.equal(out.ok, true);
      assert(out.ok);
      h.assertAcknowledged(out.value);
      h.assertBInnerOwnership();
    } finally {
      h.release("B_DIGEST");
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G11-rejected", async () => {
  const h = await scenario("G11-rejected");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_GET", observed);
      assert(h.aToken);
      assert.equal(h.controlB().forward(h.aToken), null);
      h.release("B_GET");
      const out = await observed;
      assert.equal(out.ok, false);
      assert(!out.ok);
      assert.equal(out.error.message, "INITIAL_PROVIDER_REJECTED");
      const failureDescriptor = Object.getOwnPropertyDescriptor(
        out.error,
        "failure",
      );
      assert(failureDescriptor);
      assert.equal(data(failureDescriptor.value).phase, "post");
      assert.equal(h.bPosts(), 1);
      assert.equal(h.bRecords().length, 1);
      assert.equal(h.c3Entries(), 0);
    } finally {
      h.release("B_GET");
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G12-wrong-identity", async () => {
  const h = await scenario("G12-wrong-identity");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    assert.equal(out.status, "fulfilled_unverified");
    assert(Object.prototype.hasOwnProperty.call(out, "quarantine"));
    assert.equal(h.bRecords().length, 2);
    assert.equal(h.c3Entries(), 1);
    assert.equal(out.quarantine !== null, true);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G13-late", async () => {
  const h = await scenario("G13-late");
  try {
    await h.runInitial();
    const observed = h.observe(h.invokeB());
    try {
      await h.enterOrSettled("B_POST", observed);
      h.OWNER.retire();
      const first = await observed;
      assert.equal(first.ok, false);
      h.release("B_POST");
      await h.joinObservers();
      assert.equal(h.c3Entries(), 0);
      assert.equal(h.bRecords().length, 1);
      await assert.rejects(h.invokeNewCapture(), {
        message: "INITIAL_ACTOR_STOP",
      });
    } finally {
      h.release("B_POST");
      await observed;
    }
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G14-output", async () => {
  const h = await scenario("G14-output");
  try {
    await h.runInitial();
    const out = await h.invokeB();
    h.assertOutputOnlyOverflow(out);
    assert.equal(h.ordinaryCredentialRejected(), true);
  } finally {
    await h.cleanup();
  }
  h.health();
});

it("actual owned explicit recovery G15-prior", async () => {
  const h = await scenario("G15-prior");
  try {
    await h.runInitial();
    const before = h.priorSnapshot();
    const out = await h.invokeB();
    h.assertAcknowledged(out);
    assert.deepEqual(h.priorSnapshot(), before);
    assert.equal(h.priorIsFrozen(), false);
    assert(Object.isFrozen(out));
    assert(Object.isFrozen(out.receipt));
    assert.notEqual(out.receipt, h.priorReceipt);
  } finally {
    await h.cleanup();
  }
  h.health();
});
