import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  defineSchema,
  makeFunctionReference,
} from "convex/server";
import { BetterStripe } from "../../../../index.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { modules, schema } from "../../../../../test.js";
import {
  canonical,
  codecFixture,
} from "../../../../../component/renewalOperations/timingPolicy.fixtures.js";
import { createClassActionOperationJournal } from "../operationJournal.js";

type Journal = Awaited<ReturnType<typeof createClassActionOperationJournal>>;
type Fresh = Awaited<ReturnType<Journal["reserveFreshAttempt"]>>;
export async function initialOperations(
  work: (input: {
    journal: Journal;
    fresh: Fresh;
    sdk: BetterStripe;
    index: number;
  }) => Promise<void>,
  count = 1,
) {
  const h = await codecFixture();
  const sdk = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_invalid_owner_core",
  });
  const refs = components.betterStripe.renewalOperations;
  const host = {
    run: actionGeneric({
      args: {},
      handler: async (ctx): Promise<null> => {
        await Promise.all(
          Array.from({ length: count }, async (_, index) => {
            const logicalOperationId =
              h.record.logicalOperationId + "-owner-" + index;
            const recordJSON = canonical({ ...h.record, logicalOperationId });
            const created = await ctx.runMutation(
              refs.mutations.createAuthorizedOperation,
              {
                authorizationScope: h.record.authorization.scope,
                authorizationRevision: h.record.authorization.revision,
                logicalOperationId,
                recordJSON,
              },
            );
            assert(created.status === "created");
            const journal = await createClassActionOperationJournal(sdk, {
              actualActionCtx: ctx,
              operationId: created.operationId,
            });
            const fresh = await journal.reserveFreshAttempt({
              expectedRevision: 0,
              stage: "attach",
              expectedRequestBinding: h.record.requestBinding,
              recordJSON,
            });
            assert(fresh.result.disposition === "acquired" && fresh.call);
            await work({ journal, fresh, sdk, index });
          }),
        );
        return null;
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./initialOwner.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, modules);
  await t.action(
    makeFunctionReference<"action", {}, null>("initialOwner:run"),
    {},
  );
  assert(h.fetchCalls() === 0);
}
