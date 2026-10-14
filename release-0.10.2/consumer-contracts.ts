import {BetterStripe,STRIPE_CUSTOMER_PREVIEW_API_VERSION,type SupportedStripeApiVersion} from '@fantastic.dev/better-stripe';
import {componentsGeneric,httpRouter} from 'convex/server';
import {Payouts} from '@fantastic.dev/better-stripe/react';
const version:SupportedStripeApiVersion=STRIPE_CUSTOMER_PREVIEW_API_VERSION;
const stripe=new BetterStripe(componentsGeneric().betterStripe as unknown as ConstructorParameters<typeof BetterStripe>[0],{stripeApiVersion:version});
stripe.registerRoutes(httpRouter());
void Payouts;
