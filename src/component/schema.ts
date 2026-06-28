import { defineSchema } from "convex/server";

import {
  checkoutSessionsTable,
  invoicesTable,
  subscriptionsTable,
} from "./billing/schema";
import {
  disputesTable,
  paymentsTable,
  payoutsTable,
  refundsTable,
  transfersTable,
} from "./connect/schema";
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
  refunds: refundsTable,
  disputes: disputesTable,
  transfers: transfersTable,

  // Webhooks
  webhookEvents: webhookEventsTable,
});
