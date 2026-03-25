import { registerRoutes } from '@kkampen/better-stripe';
import { httpRouter } from 'convex/server';

import { components } from './_generated/api';

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: '/stripe/webhook',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
});

export default http;
