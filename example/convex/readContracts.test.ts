// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import componentSchema from "../../src/component/schema.js";
import schema from "./schema.js";
import { api, components } from "./_generated/api.js";
const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../src/component/**/*.*s");
it("binds native paginated queries through the public client", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_a",
    accountId: "acct_a",
    name: "A",
    active: true,
  });
  const result = await t.query(api.readContracts.paginateProducts, {
    accountId: "acct_a",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(result.page).toMatchObject([{ stripeProductId: "prod_a" }]);
  expect(result.isDone).toBe(true);
});
