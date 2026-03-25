import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from 'convex/server';
import Stripe from 'stripe';

import type { ComponentApi } from '../component/_generated/component.js';

export const DEFAULT_API_VERSION = '2026-02-25.clover';

/** The component API type — use this instead of `any` for the component param */
export type Component = ComponentApi;

// =============================================================================
// RunCtx type — mirrors Convex's GenericActionCtx/GenericMutationCtx shape
// =============================================================================

export type RunCtx = {
  runQuery: <Query extends FunctionReference<'query', 'public' | 'internal'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation?: <
    Mutation extends FunctionReference<'mutation', 'public' | 'internal'>,
  >(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
};

export function getStripeClient(
  secretKey: string,
  apiVersion?: string,
): Stripe {
  return new Stripe(secretKey, {
    apiVersion: (apiVersion || DEFAULT_API_VERSION) as Stripe.LatestApiVersion,
  });
}

export function epochToIso(
  epoch: number | null | undefined,
): string | undefined {
  if (epoch == null) return undefined;
  return new Date(epoch * 1000).toISOString();
}

export async function runMutationOrThrow<
  Mutation extends FunctionReference<'mutation', 'public' | 'internal'>,
>(
  ctx: RunCtx,
  ref: Mutation,
  args: Mutation['_args'],
): Promise<FunctionReturnType<Mutation>> {
  if (!ctx.runMutation) {
    throw new Error(
      'This BetterStripe method requires a Convex ctx with runMutation.',
    );
  }

  return (await ctx.runMutation(ref, args)) as FunctionReturnType<Mutation>;
}
