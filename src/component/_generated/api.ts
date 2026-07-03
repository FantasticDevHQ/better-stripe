/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as billing_mutations from "../billing/mutations.js";
import type * as billing_queries from "../billing/queries.js";
import type * as billing_validators from "../billing/validators.js";
import type * as connect_mutations from "../connect/mutations.js";
import type * as connect_queries from "../connect/queries.js";
import type * as connect_validators from "../connect/validators.js";
import type * as core_mutations from "../core/mutations.js";
import type * as core_queries from "../core/queries.js";
import type * as core_validators from "../core/validators.js";
import type * as lib_fees from "../lib/fees.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_reversals from "../lib/reversals.js";
import type * as lib_stripeFactory from "../lib/stripeFactory.js";
import type * as products_mutations from "../products/mutations.js";
import type * as products_queries from "../products/queries.js";
import type * as products_validators from "../products/validators.js";
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
  "billing/mutations": typeof billing_mutations;
  "billing/queries": typeof billing_queries;
  "billing/validators": typeof billing_validators;
  "connect/mutations": typeof connect_mutations;
  "connect/queries": typeof connect_queries;
  "connect/validators": typeof connect_validators;
  "core/mutations": typeof core_mutations;
  "core/queries": typeof core_queries;
  "core/validators": typeof core_validators;
  "lib/fees": typeof lib_fees;
  "lib/idempotency": typeof lib_idempotency;
  "lib/reversals": typeof lib_reversals;
  "lib/stripeFactory": typeof lib_stripeFactory;
  "products/mutations": typeof products_mutations;
  "products/queries": typeof products_queries;
  "products/validators": typeof products_validators;
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
