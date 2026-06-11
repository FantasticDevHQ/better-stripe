import { defineSchema } from "convex/server";

import {
  checkoutSessionsTable,
  invoicesTable,
  subscriptionsTable,
} from "./billing/schema";
import { paymentsTable, payoutsTable } from "./connect/schema";
import { accountsTable } from "./core/schema";
import { pricesTable, productsTable } from "./products/schema";
import { webhookEventsTable } from "./webhooks/schema";

export default defineSchema({
  // Core
  accounts: accountsTable,

  // Products
  products: productsTable,
  prices: pricesTable,

  // Billing
  subscriptions: subscriptionsTable,
  checkoutSessions: checkoutSessionsTable,
  invoices: invoicesTable,

  // Connect
  payments: paymentsTable,
  payouts: payoutsTable,

  // Webhooks
  webhookEvents: webhookEventsTable,
});
