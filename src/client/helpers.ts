import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import Stripe from "stripe";

import type { ComponentApi } from "../component/_generated/component.js";
import { STRIPE_API_VERSION } from "./constants.js";
import type { StripeApiVersion } from "./stripe-types.js";

/** The component API type — use this instead of `any` for the component param */
export type Component = ComponentApi;

// =============================================================================
// RunCtx type — mirrors Convex's GenericActionCtx/GenericMutationCtx shape
// =============================================================================

export type RunCtx = {
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation?: <
    Mutation extends FunctionReference<"mutation", "public" | "internal">,
  >(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
};

/**
 * Keyed cache for Stripe SDK instances.
 * Safe for tests and mixed environments — different keys get different clients.
 *
 * NOTE: This cache is unbounded and persists for the process lifetime.
 * In practice, a BetterStripe instance typically uses 1 key.
 * API key rotation requires a process restart to pick up new keys.
 */
const _clients = new Map<string, Stripe>();

export function getStripeClient(
  secretKey: string,
  apiVersion?: string,
): Stripe {
  const version = (apiVersion as StripeApiVersion) || STRIPE_API_VERSION;
  const cacheKey = `${secretKey}:${version}`;
  let client = _clients.get(cacheKey);
  if (!client) {
    client = new Stripe(secretKey, {
      apiVersion: version,
    });
    _clients.set(cacheKey, client);
  }
  return client;
}

export function epochToIso(
  epoch: number | null | undefined,
): string | undefined {
  if (epoch == null) return undefined;
  return new Date(epoch * 1000).toISOString();
}

/**
 * The `bs*` metadata namespace is reserved for better-stripe's internal webhook
 * markers (e.g. `bsChargeType`, `bsSplit`, `bsFeeConfig`, `bsFeeMode`). Strip it
 * from caller-supplied metadata so a caller can't forge instructions that the
 * webhook engine would act on (e.g. trigger split transfers without routing).
 */
export function stripReservedMetadata(
  metadata: Record<string, string> | undefined,
): Record<string, string> {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([k]) => !k.startsWith("bs")),
  );
}

export async function runMutationOrThrow<
  Mutation extends FunctionReference<"mutation", "public" | "internal">,
>(
  ctx: RunCtx,
  ref: Mutation,
  args: Mutation["_args"],
): Promise<FunctionReturnType<Mutation>> {
  if (!ctx.runMutation) {
    throw new Error(
      "This BetterStripe method requires a Convex ctx with runMutation.",
    );
  }

  return (await ctx.runMutation(ref, args)) as FunctionReturnType<Mutation>;
}
