/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

import type * as billing_mutations from "../billing/mutations.js";
import type * as billing_queries from "../billing/queries.js";
import type * as connect_mutations from "../connect/mutations.js";
import type * as connect_queries from "../connect/queries.js";
import type * as core_mutations from "../core/mutations.js";
import type * as core_queries from "../core/queries.js";
import type * as products_mutations from "../products/mutations.js";
import type * as products_queries from "../products/queries.js";
import type * as webhooks_mutations from "../webhooks/mutations.js";
import type * as webhooks_queries from "../webhooks/queries.js";

const fullApi: ApiFromModules<{
  "billing/mutations": typeof billing_mutations;
  "billing/queries": typeof billing_queries;
  "connect/mutations": typeof connect_mutations;
  "connect/queries": typeof connect_queries;
  "core/mutations": typeof core_mutations;
  "core/queries": typeof core_queries;
  "products/mutations": typeof products_mutations;
  "products/queries": typeof products_queries;
  "webhooks/mutations": typeof webhooks_mutations;
  "webhooks/queries": typeof webhooks_queries;
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
