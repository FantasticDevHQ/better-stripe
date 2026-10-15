/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as connect_reversalClaims from "../connect/reversalClaims.js";
import type * as connect_reversalReceipts from "../connect/reversalReceipts.js";
import type * as settlement_clawbackSchema from "../settlement/clawbackSchema.js";
import type * as settlement_clawbacks from "../settlement/clawbacks.js";
import type * as affiliateRecovery_schema from "../affiliateRecovery/schema.js";
import type * as affiliateRecovery_accounting from "../affiliateRecovery/accounting.js";
import type * as affiliateRecovery_mutations from "../affiliateRecovery/mutations.js";
import type * as affiliateEarnings_mutations from "../affiliateEarnings/mutations.js";
import type * as affiliateRecovery_queries from "../affiliateRecovery/queries.js";
import type * as affiliatePayouts_mutations from "../affiliatePayouts/mutations.js";
import type * as affiliatePayouts_queries from "../affiliatePayouts/queries.js";
import type * as billing_mutations from "../billing/mutations.js";
import type * as billing_queries from "../billing/queries.js";
import type * as billing_validators from "../billing/validators.js";
import type * as connect_mutations from "../connect/mutations.js";
import type * as connect_queries from "../connect/queries.js";
import type * as connect_validators from "../connect/validators.js";
import type * as core_mutations from "../core/mutations.js";
import type * as core_queries from "../core/queries.js";
import type * as core_validators from "../core/validators.js";
import type * as costRecovery_claims from "../costRecovery/claims.js";
import type * as costRecovery_completion from "../costRecovery/completion.js";
import type * as costRecovery_helpers from "../costRecovery/helpers.js";
import type * as costRecovery_mutations from "../costRecovery/mutations.js";
import type * as costRecovery_queries from "../costRecovery/queries.js";
import type * as costRecovery_reservations from "../costRecovery/reservations.js";
import type * as lib_fees from "../lib/fees.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_paymentSeller from "../lib/paymentSeller.js";
import type * as lib_reversals from "../lib/reversals.js";
import type * as lib_stripeFactory from "../lib/stripeFactory.js";
import type * as products_mutations from "../products/mutations.js";
import type * as products_queries from "../products/queries.js";
import type * as products_validators from "../products/validators.js";
import type * as settlement_mutations from "../settlement/mutations.js";
import type * as settlement_queries from "../settlement/queries.js";
import type * as webhooks_mutations from "../webhooks/mutations.js";
import type * as webhooks_queries from "../webhooks/queries.js";
import type * as webhooks_validators from "../webhooks/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  "connect/reversalClaims": typeof connect_reversalClaims;
  "connect/reversalReceipts": typeof connect_reversalReceipts;
  "settlement/clawbackSchema": typeof settlement_clawbackSchema;
  "settlement/clawbacks": typeof settlement_clawbacks;
  "affiliateRecovery/schema": typeof affiliateRecovery_schema;
  "affiliateRecovery/accounting": typeof affiliateRecovery_accounting;
  "affiliateRecovery/mutations": typeof affiliateRecovery_mutations;
  "affiliateEarnings/mutations": typeof affiliateEarnings_mutations;
  "affiliateRecovery/queries": typeof affiliateRecovery_queries;
  "affiliatePayouts/mutations": typeof affiliatePayouts_mutations;
  "affiliatePayouts/queries": typeof affiliatePayouts_queries;
  "billing/mutations": typeof billing_mutations;
  "billing/queries": typeof billing_queries;
  "billing/validators": typeof billing_validators;
  "connect/mutations": typeof connect_mutations;
  "connect/queries": typeof connect_queries;
  "connect/validators": typeof connect_validators;
  "core/mutations": typeof core_mutations;
  "core/queries": typeof core_queries;
  "core/validators": typeof core_validators;
  "costRecovery/claims": typeof costRecovery_claims;
  "costRecovery/completion": typeof costRecovery_completion;
  "costRecovery/helpers": typeof costRecovery_helpers;
  "costRecovery/mutations": typeof costRecovery_mutations;
  "costRecovery/queries": typeof costRecovery_queries;
  "costRecovery/reservations": typeof costRecovery_reservations;
  "lib/fees": typeof lib_fees;
  "lib/idempotency": typeof lib_idempotency;
  "lib/paymentSeller": typeof lib_paymentSeller;
  "lib/reversals": typeof lib_reversals;
  "lib/stripeFactory": typeof lib_stripeFactory;
  "products/mutations": typeof products_mutations;
  "products/queries": typeof products_queries;
  "products/validators": typeof products_validators;
  "settlement/mutations": typeof settlement_mutations;
  "settlement/queries": typeof settlement_queries;
  "webhooks/mutations": typeof webhooks_mutations;
  "webhooks/queries": typeof webhooks_queries;
  "webhooks/validators": typeof webhooks_validators;
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

export const components = componentsGeneric() as unknown as {};
