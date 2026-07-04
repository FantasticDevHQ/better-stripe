/**
 * Type-level drift guard for `testing.tsx`'s admin Testing API surface
 * (BTS-77).
 *
 * `adminTesting.ts` (example/convex) originally postdated this app's
 * checked-in `_generated/api.ts`, so `api.adminTesting` wasn't in the
 * generated type at all — `testing.tsx` reached for a hand-maintained
 * `const adminTesting = (api as any).adminTesting;` shim to route around it
 * (see git history on `testing.tsx`, and BTS-70/BTS-76's codegen fix that
 * removed the shim). `testing.tsx` now calls `adminTestingActions.*`, a single
 * page-facing binding that must stay backed by the real generated API
 * references.
 *
 * This file has no runtime behavior and is never imported. Its only job is
 * to be part of `tsc -b` (via `example`'s `pnpm typecheck`, which walks every
 * file under `src`): if the exported page binding is replaced by an
 * `any`-typed shim or a manually maintained FunctionReference with stale
 * args/returns, the checks below stop typechecking.
 */
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  RegisteredAction,
  RegisteredQuery,
} from "convex/server";

import type { api } from "../../../convex/_generated/api";
import type * as AdminTestingModule from "../../../convex/adminTesting";
import type { adminTestingActions } from "./adminTestingActions";

type Visibility = "public" | "internal";

/** Extracts a registered query/action's declared Args type. */
type HandlerArgs<Fn> =
  Fn extends RegisteredAction<Visibility, infer Args, unknown>
    ? Args
    : Fn extends RegisteredQuery<Visibility, infer Args, unknown>
      ? Args
      : never;

/** Extracts a registered query/action's declared (awaited) return type. */
type HandlerReturn<Fn> =
  Fn extends RegisteredAction<Visibility, Record<string, unknown>, infer Return>
    ? Awaited<Return>
    : Fn extends RegisteredQuery<
          Visibility,
          Record<string, unknown>,
          infer Return
        >
      ? Awaited<Return>
      : never;

/** Strict (non-widening) type equality — fails closed on any divergence. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// `Expect<T extends true>` only typechecks when applied to an already-
// concrete `Equal<...>` result — NOT wrapped inside another generic alias
// (a generic alias body must satisfy its own constraints independent of any
// later instantiation, so `Equal<A, B>` would still be the open `boolean`
// type there). Every check below is therefore inlined directly against
// concrete `typeof realExport` / `typeof api.adminTesting.x` pairs.
type Expect<T extends true> = T;

type RealArgs<Name extends keyof typeof AdminTestingModule> = HandlerArgs<
  (typeof AdminTestingModule)[Name]
>;
type RealReturn<Name extends keyof typeof AdminTestingModule> = HandlerReturn<
  (typeof AdminTestingModule)[Name]
>;
type ApiArgs<Name extends keyof typeof api.adminTesting> = FunctionArgs<
  (typeof api.adminTesting)[Name]
>;
type ApiReturn<Name extends keyof typeof api.adminTesting> = FunctionReturnType<
  (typeof api.adminTesting)[Name]
>;
type PageActionName =
  | "fireAccountUpdated"
  | "fireSubscriptionUpdated"
  | "fireCheckoutCompleted"
  | "fireInvoicePaid";
type PageActionBinding = typeof adminTestingActions;
type PageActionRef<Name extends PageActionName> =
  Name extends keyof PageActionBinding ? PageActionBinding[Name] : never;
type RealActionRef<Name extends PageActionName> = FunctionReference<
  "action",
  "public",
  RealArgs<Name>,
  RealReturn<Name>
>;
type PageActionArgs<Name extends PageActionName> = FunctionArgs<
  PageActionRef<Name>
>;
type PageActionReturn<Name extends PageActionName> = FunctionReturnType<
  PageActionRef<Name>
>;
type RealActionArgs<Name extends PageActionName> = FunctionArgs<
  RealActionRef<Name>
>;
type RealActionReturn<Name extends PageActionName> = FunctionReturnType<
  RealActionRef<Name>
>;
type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? false : true;

// One pair of generated-vs-real checks (args, return) per function exposed to
// the page. If any of these stop compiling, `_generated/api.ts` and the real
// `adminTesting.ts` exports have drifted.
export type AdminTestingApiShapeCheck = [
  Expect<Equal<RealArgs<"getDemoAccounts">, ApiArgs<"getDemoAccounts">>>,
  Expect<Equal<RealReturn<"getDemoAccounts">, ApiReturn<"getDemoAccounts">>>,
  Expect<Equal<RealArgs<"fireAccountUpdated">, ApiArgs<"fireAccountUpdated">>>,
  Expect<
    Equal<RealReturn<"fireAccountUpdated">, ApiReturn<"fireAccountUpdated">>
  >,
  Expect<
    Equal<RealArgs<"fireSubscriptionUpdated">, ApiArgs<"fireSubscriptionUpdated">>
  >,
  Expect<
    Equal<
      RealReturn<"fireSubscriptionUpdated">,
      ApiReturn<"fireSubscriptionUpdated">
    >
  >,
  Expect<
    Equal<RealArgs<"fireCheckoutCompleted">, ApiArgs<"fireCheckoutCompleted">>
  >,
  Expect<
    Equal<
      RealReturn<"fireCheckoutCompleted">,
      ApiReturn<"fireCheckoutCompleted">
    >
  >,
  Expect<Equal<RealArgs<"fireInvoicePaid">, ApiArgs<"fireInvoicePaid">>>,
  Expect<Equal<RealReturn<"fireInvoicePaid">, ApiReturn<"fireInvoicePaid">>>,
];

// Non-tautological guard for the value consumed by `testing.tsx`. This catches
// the original regression class: reintroducing a hand-maintained
// `(api as any).adminTesting` shim or stale `makeFunctionReference` signatures
// in the page-facing binding.
export type AdminTestingPageBindingShapeCheck = [
  Expect<Equal<keyof PageActionBinding, PageActionName>>,
  Expect<NotAny<PageActionRef<"fireAccountUpdated">>>,
  Expect<
    Equal<PageActionRef<"fireAccountUpdated">, RealActionRef<"fireAccountUpdated">>
  >,
  Expect<
    Equal<
      PageActionArgs<"fireAccountUpdated">,
      RealActionArgs<"fireAccountUpdated">
    >
  >,
  Expect<
    Equal<
      PageActionReturn<"fireAccountUpdated">,
      RealActionReturn<"fireAccountUpdated">
    >
  >,
  Expect<NotAny<PageActionRef<"fireSubscriptionUpdated">>>,
  Expect<
    Equal<
      PageActionRef<"fireSubscriptionUpdated">,
      RealActionRef<"fireSubscriptionUpdated">
    >
  >,
  Expect<
    Equal<
      PageActionArgs<"fireSubscriptionUpdated">,
      RealActionArgs<"fireSubscriptionUpdated">
    >
  >,
  Expect<
    Equal<
      PageActionReturn<"fireSubscriptionUpdated">,
      RealActionReturn<"fireSubscriptionUpdated">
    >
  >,
  Expect<NotAny<PageActionRef<"fireCheckoutCompleted">>>,
  Expect<
    Equal<
      PageActionRef<"fireCheckoutCompleted">,
      RealActionRef<"fireCheckoutCompleted">
    >
  >,
  Expect<
    Equal<
      PageActionArgs<"fireCheckoutCompleted">,
      RealActionArgs<"fireCheckoutCompleted">
    >
  >,
  Expect<
    Equal<
      PageActionReturn<"fireCheckoutCompleted">,
      RealActionReturn<"fireCheckoutCompleted">
    >
  >,
  Expect<NotAny<PageActionRef<"fireInvoicePaid">>>,
  Expect<
    Equal<PageActionRef<"fireInvoicePaid">, RealActionRef<"fireInvoicePaid">>
  >,
  Expect<
    Equal<PageActionArgs<"fireInvoicePaid">, RealActionArgs<"fireInvoicePaid">>
  >,
  Expect<
    Equal<PageActionReturn<"fireInvoicePaid">, RealActionReturn<"fireInvoicePaid">>
  >,
];
