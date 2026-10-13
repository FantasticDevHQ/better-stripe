/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as adminTesting from "../adminTesting.js";
import type * as affiliateSplit from "../affiliateSplit.js";
import type * as authz from "../authz.js";
import type * as e2eCheckout from "../e2eCheckout.js";
import type * as e2eMoney from "../e2eMoney.js";
import type * as http from "../http.js";
import type * as lib_marketplace from "../lib/marketplace.js";
import type * as lib_sandboxFixturePlan from "../lib/sandboxFixturePlan.js";
import type * as lib_sandboxFixtureResources from "../lib/sandboxFixtureResources.js";
import type * as lib_sellerCostLedger from "../lib/sellerCostLedger.js";
import type * as lib_sellerCostValidators from "../lib/sellerCostValidators.js";
import type * as lib_sellerCosts from "../lib/sellerCosts.js";
import type * as lib_storePlanValidators from "../lib/storePlanValidators.js";
import type * as lib_storePlans from "../lib/storePlans.js";
import type * as lib_storeRecipient from "../lib/storeRecipient.js";
import type * as lib_stripeClient from "../lib/stripeClient.js";
import type * as marketplace from "../marketplace.js";
import type * as queries from "../queries.js";
import type * as recipientPayouts from "../recipientPayouts.js";
import type * as reset from "../reset.js";
import type * as sandboxFixtureState from "../sandboxFixtureState.js";
import type * as sandboxFixtures from "../sandboxFixtures.js";
import type * as sandboxRenewals from "../sandboxRenewals.js";
import type * as seed from "../seed.js";
import type * as sellerCostActions from "../sellerCostActions.js";
import type * as sellerCostBilling from "../sellerCostBilling.js";
import type * as setup from "../setup.js";
import type * as storeBalanceActions from "../storeBalanceActions.js";
import type * as storeBalanceFunding from "../storeBalanceFunding.js";
import type * as storeBillingEvents from "../storeBillingEvents.js";
import type * as storeInvoiceActions from "../storeInvoiceActions.js";
import type * as storePlanActions from "../storePlanActions.js";
import type * as storePlanBilling from "../storePlanBilling.js";
import type * as storeSaleSettlement from "../storeSaleSettlement.js";
import type * as storefront from "../storefront.js";
import type * as stripe from "../stripe.js";
import type * as subscriptionLifecycle from "../subscriptionLifecycle.js";
import type * as triggerLogger from "../triggerLogger.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  actions: typeof actions;
  adminTesting: typeof adminTesting;
  affiliateSplit: typeof affiliateSplit;
  authz: typeof authz;
  e2eCheckout: typeof e2eCheckout;
  e2eMoney: typeof e2eMoney;
  http: typeof http;
  "lib/marketplace": typeof lib_marketplace;
  "lib/sandboxFixturePlan": typeof lib_sandboxFixturePlan;
  "lib/sandboxFixtureResources": typeof lib_sandboxFixtureResources;
  "lib/sellerCostLedger": typeof lib_sellerCostLedger;
  "lib/sellerCostValidators": typeof lib_sellerCostValidators;
  "lib/sellerCosts": typeof lib_sellerCosts;
  "lib/storePlanValidators": typeof lib_storePlanValidators;
  "lib/storePlans": typeof lib_storePlans;
  "lib/storeRecipient": typeof lib_storeRecipient;
  "lib/stripeClient": typeof lib_stripeClient;
  marketplace: typeof marketplace;
  queries: typeof queries;
  recipientPayouts: typeof recipientPayouts;
  reset: typeof reset;
  sandboxFixtureState: typeof sandboxFixtureState;
  sandboxFixtures: typeof sandboxFixtures;
  sandboxRenewals: typeof sandboxRenewals;
  seed: typeof seed;
  sellerCostActions: typeof sellerCostActions;
  sellerCostBilling: typeof sellerCostBilling;
  setup: typeof setup;
  storeBalanceActions: typeof storeBalanceActions;
  storeBalanceFunding: typeof storeBalanceFunding;
  storeBillingEvents: typeof storeBillingEvents;
  storeInvoiceActions: typeof storeInvoiceActions;
  storePlanActions: typeof storePlanActions;
  storePlanBilling: typeof storePlanBilling;
  storeSaleSettlement: typeof storeSaleSettlement;
  storefront: typeof storefront;
  stripe: typeof stripe;
  subscriptionLifecycle: typeof subscriptionLifecycle;
  triggerLogger: typeof triggerLogger;
  users: typeof users;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  betterStripe: import("@fantastic.dev/better-stripe/_generated/component.js").ComponentApi<"betterStripe">;
};
