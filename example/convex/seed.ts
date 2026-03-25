import { internal } from './_generated/api';
import { internalAction, internalMutation } from './_generated/server';
import { stripe } from './stripe';

/**
 * Seed DB data (users + courses). Mutation — no external calls.
 * Returns user IDs for logging. Skips if already seeded.
 */
export const seedDb = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existingUsers = await ctx.db.query('users').collect();
    if (existingUsers.length > 0) {
      console.log('[seed] DB already seeded — skipping.');
      return { alreadySeeded: true };
    }

    const learnerId = await ctx.db.insert('users', {
      name: 'Alex Learner',
      email: 'alex@example.com',
      role: 'learner',
    });

    const creatorId = await ctx.db.insert('users', {
      name: 'Jordan Creator',
      email: 'jordan@example.com',
      role: 'creator',
    });

    await ctx.db.insert('users', {
      name: 'Sam Admin',
      email: 'sam@example.com',
      role: 'admin',
    });

    await ctx.db.insert('courses', {
      title: 'Introduction to TypeScript',
      description:
        'Learn TypeScript from scratch with hands-on projects and real-world examples.',
      creatorUserId: creatorId,
      published: true,
    });

    await ctx.db.insert('courses', {
      title: 'Advanced React Patterns',
      description:
        'Master compound components, render props, custom hooks, and state machines.',
      creatorUserId: creatorId,
      published: true,
    });

    await ctx.db.insert('courses', {
      title: 'Building with Convex',
      description:
        'Build real-time full-stack apps with Convex — queries, mutations, actions, and components.',
      creatorUserId: creatorId,
      published: true,
    });

    console.log(
      `[seed] DB seeded: 3 users, 3 courses (learner=${learnerId}, creator=${creatorId})`,
    );
    return { alreadySeeded: false };
  },
});

/**
 * Seed Stripe products and prices via BetterStripe. Action — makes Stripe API calls.
 * Idempotent: checks if products already exist in the component before creating.
 */
export const seedStripe = internalAction({
  args: {},
  handler: async (ctx) => {
    // Check if products already exist
    const existingProducts = await stripe.listProducts(ctx);
    if (existingProducts.length > 0) {
      console.log(
        `[seed] Stripe products already exist (${existingProducts.length}) — skipping.`,
      );
      return { alreadySeeded: true, productCount: existingProducts.length };
    }

    // Product 1: BetterLearn Pro (subscription)
    const proProduct = await stripe.createProduct(ctx, {
      name: 'BetterLearn Pro',
      description: 'Full access to all courses and learning materials',
    });

    await stripe.createPrice(ctx, {
      stripeProductId: proProduct.stripeProductId,
      unitAmount: 900,
      currency: 'usd',
      type: 'recurring',
      interval: 'month',
    });

    await stripe.createPrice(ctx, {
      stripeProductId: proProduct.stripeProductId,
      unitAmount: 8900,
      currency: 'usd',
      type: 'recurring',
      interval: 'year',
      metadata: { trialDays: '7' },
    });

    // Product 2: Masterclass Bundle (one-time)
    const bundleProduct = await stripe.createProduct(ctx, {
      name: 'Masterclass Bundle',
      description: 'One-time purchase: 3 premium masterclass courses',
    });

    await stripe.createPrice(ctx, {
      stripeProductId: bundleProduct.stripeProductId,
      unitAmount: 4900,
      currency: 'usd',
      type: 'one_time',
    });

    console.log('[seed] Stripe seeded: 2 products, 3 prices');
    return { alreadySeeded: false, productCount: 2 };
  },
});

/**
 * Full seed: DB data + Stripe products. Called by setup script.
 */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.seed.seedDb, {});
    await ctx.runAction(internal.seed.seedStripe, {});
  },
});
