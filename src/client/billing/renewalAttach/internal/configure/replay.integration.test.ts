import assert from "node:assert/strict";
import { it } from "vitest";
import { configureWriteFixture } from "../test-fixtures/configureWriteOperation.js";
import { writeCases } from "../test-fixtures/configureWriteDeclarations.js";
import {
  assertProviderFailure,
  assertConfigureACK,
} from "../test-fixtures/configureWriteAssertions.js";

for (const name of writeCases.replay)
  it(
    "bounded configure writer explicit original-key replay: " + name,
    async () => {
      const h = await configureWriteFixture(name);
      let initial: Promise<unknown> | undefined;
      try {
        assert.equal(h.replayDeclaration.persistentCustody, false);
        assert.equal(h.replayDeclaration.permitsJSONRehydration, false);
        if (name === "not-posted-prior") {
          assert.deepEqual(await h.captureReplayB().invoke(), {
            status: "not_dispatched",
            reason: "prior_attempt_unavailable",
            operationalAuthority: false,
          });
          assert.equal(h.replayStates.B.calls.length, 0);
          return;
        }
        const firstHandle = h.captureWriter();
        const firstPending = firstHandle.invoke();
        initial = firstPending;
        const firstObserved = firstPending.then(
          (value: unknown) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        if (name === "pending-prior") {
          await h.writeGates.entered("post", firstPending);
          assert.deepEqual(await h.captureReplayB().invoke(), {
            status: "not_dispatched",
            reason: "prior_attempt_not_replayable",
            operationalAuthority: false,
          });
          assert.equal(h.replayStates.B.calls.length, 0);
          h.writeGates.release("post");
          const settled = await firstObserved;
          assert.equal(settled.ok, true);
          return;
        }
        const first = await firstObserved;
        if (name === "acknowledged-prior") {
          assert.equal(first.ok, true);
          if (first.ok) assertConfigureACK(h, first.value);
        } else {
          assert.equal(first.ok, false);
          if (!first.ok) assertProviderFailure(h, first.error, "post");
        }
        const firstPosts = h.writeState.calls.filter(
          (row) => row.method === "POST",
        );
        assert.equal(firstPosts.length, 1);
        await assert.rejects(firstHandle.invoke(), {
          message: "CONFIGURE_WRITE_STOP",
        });
        assert.equal(
          h.writeState.calls.filter((row) => row.method === "POST").length,
          1,
        );
        if (name === "expired-owner") h.OWNER.retire();
        const refusal = [
          "acknowledged-prior",
          "foreign-prior",
          "cloned-prior",
          "already-applied",
          "baseline-drift",
          "expired-owner",
        ].includes(name);
        const B = h.captureReplayB();
        if (refusal) {
          if (name === "expired-owner")
            await assert.rejects(B.invoke(), {
              message: "CONFIGURE_WRITE_STOP",
            });
          else {
            const reason =
              name === "foreign-prior" || name === "cloned-prior"
                ? "prior_attempt_unavailable"
                : name === "already-applied" || name === "baseline-drift"
                  ? "preconfigure_baseline_changed"
                  : "prior_attempt_not_replayable";
            assert.deepEqual(await B.invoke(), {
              status: "not_dispatched",
              reason,
              operationalAuthority: false,
            });
          }
          assert.equal(
            h.replayStates.B.calls.filter((row) => row.method === "POST")
              .length,
            0,
          );
          if (name === "already-applied" || name === "baseline-drift") {
            assert.equal(
              h.replayStates.B.calls.length,
              4 + h.write.currentBundle.couponReads.length,
            );
            assert.equal(h.replayStates.B.requests.length, 1);
          } else {
            assert.equal(h.replayStates.B.calls.length, 0);
            assert.equal(h.replayStates.B.pairLoads, 0);
          }
          return;
        }
        const bView = { ...h, writeState: h.replayStates.B };
        if (name === "unknown-replay-repeat") {
          const error = await B.invoke().then(
            () => assert.fail("EXPECTED_ACTUAL_B_UNKNOWN"),
            (error: unknown) => error,
          );
          assertProviderFailure(bView, error, "post");
        } else assertConfigureACK(bView, await B.invoke());
        const bPosts = h.replayStates.B.calls.filter(
          (row) => row.method === "POST",
        );
        assert.equal(bPosts.length, 1);
        assert.deepEqual(bPosts[0], firstPosts[0]);
        if (name === "unknown-replay-repeat") {
          const C = h.captureReplayC();
          assertConfigureACK(
            { ...h, writeState: h.replayStates.C },
            await C.invoke(),
          );
          const cPosts = h.replayStates.C.calls.filter(
            (row) => row.method === "POST",
          );
          assert.equal(cPosts.length, 1);
          assert.deepEqual(cPosts[0], firstPosts[0]);
        }
        if (name === "ack-closes-ancestor") {
          assert.deepEqual(await h.captureReplayC().invoke(), {
            status: "not_dispatched",
            reason: "prior_attempt_not_replayable",
            operationalAuthority: false,
          });
          assert.equal(h.replayStates.C.calls.length, 0);
          assert.equal(h.replayStates.C.pairLoads, 0);
          assert.equal(h.OWNER.check().retired, false);
        }
        assert.equal(h.replayDeclaration.originalRequest, h.projected);
        assert.equal(h.replayDeclaration.permitsAutomaticRetry, false);
        for (const stage of [
          h.writeState,
          h.replayStates.B,
          h.replayStates.C,
        ]) {
          assert(
            stage.calls.filter((row) => row.method === "POST").length <= 1,
          );
          for (const post of stage.calls.filter(
            (row) => row.method === "POST",
          )) {
            assert.equal(post.path, h.projected.path);
            assert.equal(post.key, h.projected.key);
          }
        }
        for (const s of [h.writeState, h.replayStates.B, h.replayStates.C])
          for (const request of s.requests)
            assert.deepEqual(request, h.projected);
      } finally {
        h.writeGates.release("post");
        if (initial) await initial.catch(() => {});
        await h.cleanup();
      }
    },
  );
