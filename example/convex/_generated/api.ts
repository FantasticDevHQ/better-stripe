/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts_actions from "../accounts/actions.js";
import type * as accounts_helpers from "../accounts/helpers.js";
import type * as accounts_queries from "../accounts/queries.js";
import type * as admin_actions from "../admin/actions.js";
import type * as admin_queries from "../admin/queries.js";
import type * as admin_reset_actions from "../admin/reset/actions.js";
import type * as admin_reset_mutations from "../admin/reset/mutations.js";
import type * as admin_seed_actions from "../admin/seed/actions.js";
import type * as admin_seed_helpers from "../admin/seed/helpers.js";
import type * as admin_seed_mutations from "../admin/seed/mutations.js";
import type * as adminTesting_actions from "../adminTesting/actions.js";
import type * as adminTesting_helpers from "../adminTesting/helpers.js";
import type * as adminTesting_queries from "../adminTesting/queries.js";
import type * as affiliateDefaults_helpers from "../affiliateDefaults/helpers.js";
import type * as affiliateDefaults_mutations from "../affiliateDefaults/mutations.js";
import type * as affiliateDefaults_queries from "../affiliateDefaults/queries.js";
import type * as affiliateRecovery_billingSandbox_actions from "../affiliateRecovery/billingSandbox/actions.js";
import type * as affiliateRecovery_helpers from "../affiliateRecovery/helpers.js";
import type * as affiliateRecovery_internal_queries from "../affiliateRecovery/internal/queries.js";
import type * as affiliateRecovery_jobs_actions from "../affiliateRecovery/jobs/actions.js";
import type * as affiliateRecovery_public_actions from "../affiliateRecovery/public/actions.js";
import type * as affiliateRecovery_public_queries from "../affiliateRecovery/public/queries.js";
import type * as affiliateRecovery_sandbox_actions from "../affiliateRecovery/sandbox/actions.js";
import type * as billing_checkoutHistory from "../billing/checkoutHistory.js";
import type * as billing_events_actions from "../billing/events/actions.js";
import type * as billing_invoiceHistory from "../billing/invoiceHistory.js";
import type * as billing_invoicePayments from "../billing/invoicePayments.js";
import type * as billing_personalAccountMapping from "../billing/personalAccountMapping.js";
import type * as billing_public_actions from "../billing/public/actions.js";
import type * as billing_public_queries from "../billing/public/queries.js";
import type * as billing_subscriptionLifecycle from "../billing/subscriptionLifecycle.js";
import type * as checkoutExamples_actions from "../checkoutExamples/actions.js";
import type * as checkoutExamples_queries from "../checkoutExamples/queries.js";
import type * as connect_actions from "../connect/actions.js";
import type * as connect_queries from "../connect/queries.js";
import type * as connect_refundCommandEvidence from "../connect/refundCommandEvidence.js";
import type * as connect_refundCommandNormalization from "../connect/refundCommandNormalization.js";
import type * as connect_refundContext from "../connect/refundContext.js";
import type * as crons from "../crons.js";
import type * as e2eCheckout_actions from "../e2eCheckout/actions.js";
import type * as e2eMoney_actions from "../e2eMoney/actions.js";
import type * as e2eMoney_helpers from "../e2eMoney/helpers.js";
import type * as e2eMoney_queries from "../e2eMoney/queries.js";
import type * as embeddedExamples_helpers from "../embeddedExamples/helpers.js";
import type * as embeddedExamples_internal_queries from "../embeddedExamples/internal/queries.js";
import type * as embeddedExamples_public_actions from "../embeddedExamples/public/actions.js";
import type * as http from "../http.js";
import type * as marketplace_accountActions from "../marketplace/accountActions.js";
import type * as marketplace_accountConfiguration from "../marketplace/accountConfiguration.js";
import type * as marketplace_actions from "../marketplace/actions.js";
import type * as marketplace_affiliateSplit from "../marketplace/affiliateSplit.js";
import type * as marketplace_checkoutActions from "../marketplace/checkoutActions.js";
import type * as marketplace_commission from "../marketplace/commission.js";
import type * as marketplace_commissionMigration_mutations from "../marketplace/commissionMigration/mutations.js";
import type * as marketplace_helpers from "../marketplace/helpers.js";
import type * as marketplace_model from "../marketplace/model.js";
import type * as marketplace_personaQueries from "../marketplace/personaQueries.js";
import type * as marketplace_queries from "../marketplace/queries.js";
import type * as payoutWorkers_actions from "../payoutWorkers/actions.js";
import type * as payoutWorkers_helpers from "../payoutWorkers/helpers.js";
import type * as payoutWorkers_scope_helpers from "../payoutWorkers/scope/helpers.js";
import type * as payoutWorkers_scope_queries from "../payoutWorkers/scope/queries.js";
import type * as products_actions from "../products/actions.js";
import type * as products_queries from "../products/queries.js";
import type * as readContracts_queries from "../readContracts/queries.js";
import type * as recipientPayouts_helpers from "../recipientPayouts/helpers.js";
import type * as recipientPayouts_internal_queries from "../recipientPayouts/internal/queries.js";
import type * as recipientPayouts_policy_actions from "../recipientPayouts/policy/actions.js";
import type * as recipientPayouts_policy_helpers from "../recipientPayouts/policy/helpers.js";
import type * as recipientPayouts_policyView from "../recipientPayouts/policyView.js";
import type * as recipientPayouts_public_actions from "../recipientPayouts/public/actions.js";
import type * as sandboxFixtures_helpers from "../sandboxFixtures/helpers.js";
import type * as sandboxFixtures_internal_actions from "../sandboxFixtures/internal/actions.js";
import type * as sandboxFixtures_plan from "../sandboxFixtures/plan.js";
import type * as sandboxFixtures_public_actions from "../sandboxFixtures/public/actions.js";
import type * as sandboxFixtures_renewalPurchase from "../sandboxFixtures/renewalPurchase.js";
import type * as sandboxFixtures_renewals_actions from "../sandboxFixtures/renewals/actions.js";
import type * as sandboxFixtures_renewals_helpers from "../sandboxFixtures/renewals/helpers.js";
import type * as sandboxFixtures_renewals_mutations from "../sandboxFixtures/renewals/mutations.js";
import type * as sandboxFixtures_renewals_queries from "../sandboxFixtures/renewals/queries.js";
import type * as sandboxFixtures_resources from "../sandboxFixtures/resources.js";
import type * as sandboxFixtures_state_helpers from "../sandboxFixtures/state/helpers.js";
import type * as sandboxFixtures_state_internal_mutations from "../sandboxFixtures/state/internal/mutations.js";
import type * as sandboxFixtures_state_internal_queries from "../sandboxFixtures/state/internal/queries.js";
import type * as sandboxFixtures_state_public_queries from "../sandboxFixtures/state/public/queries.js";
import type * as sellerAffiliateRates_helpers from "../sellerAffiliateRates/helpers.js";
import type * as sellerAffiliateRates_internal_queries from "../sellerAffiliateRates/internal/queries.js";
import type * as sellerAffiliateRates_public_mutations from "../sellerAffiliateRates/public/mutations.js";
import type * as sellerAffiliateRates_public_queries from "../sellerAffiliateRates/public/queries.js";
import type * as sellerCosts_actions from "../sellerCosts/actions.js";
import type * as sellerCosts_billing_internal_mutations from "../sellerCosts/billing/internal/mutations.js";
import type * as sellerCosts_billing_public_queries from "../sellerCosts/billing/public/queries.js";
import type * as sellerCosts_helpers from "../sellerCosts/helpers.js";
import type * as sellerCosts_invoiceRecoverySource from "../sellerCosts/invoiceRecoverySource.js";
import type * as sellerCosts_invoices_actions from "../sellerCosts/invoices/actions.js";
import type * as sellerCosts_invoices_helpers from "../sellerCosts/invoices/helpers.js";
import type * as sellerCosts_migration_mutations from "../sellerCosts/migration/mutations.js";
import type * as sellerCosts_migration_queries from "../sellerCosts/migration/queries.js";
import type * as sellerCosts_recovery from "../sellerCosts/recovery.js";
import type * as sellerCosts_recoveryInvoices_actions from "../sellerCosts/recoveryInvoices/actions.js";
import type * as sellerCosts_recoveryInvoices_mutations from "../sellerCosts/recoveryInvoices/mutations.js";
import type * as sellerCosts_recoveryInvoices_workflow_actions from "../sellerCosts/recoveryInvoices/workflow/actions.js";
import type * as sellerCosts_recoveryInvoices_workflow_mutations from "../sellerCosts/recoveryInvoices/workflow/mutations.js";
import type * as sellerCosts_unsettledCostSource from "../sellerCosts/unsettledCostSource.js";
import type * as sellerCosts_validators from "../sellerCosts/validators.js";
import type * as sellerCosts_workflow_actions from "../sellerCosts/workflow/actions.js";
import type * as sellerCosts_workflow_helpers from "../sellerCosts/workflow/helpers.js";
import type * as sellerCosts_workflow_mutations from "../sellerCosts/workflow/mutations.js";
import type * as sellerCosts_workflow_queries from "../sellerCosts/workflow/queries.js";
import type * as sellerCosts_workflow_validators from "../sellerCosts/workflow/validators.js";
import type * as settlement_internal_actions from "../settlement/internal/actions.js";
import type * as settlement_internal_mutations from "../settlement/internal/mutations.js";
import type * as settlement_internal_queries from "../settlement/internal/queries.js";
import type * as settlement_public_queries from "../settlement/public/queries.js";
import type * as settlement_recovery from "../settlement/recovery.js";
import type * as settlement_workflow_actions from "../settlement/workflow/actions.js";
import type * as settlement_workflow_helpers from "../settlement/workflow/helpers.js";
import type * as settlement_workflow_mutations from "../settlement/workflow/mutations.js";
import type * as storeBalance_actions from "../storeBalance/actions.js";
import type * as storeBalance_backfill_actions from "../storeBalance/backfill/actions.js";
import type * as storeBalance_backfill_mutations from "../storeBalance/backfill/mutations.js";
import type * as storeBalance_backfill_queries from "../storeBalance/backfill/queries.js";
import type * as storeBalance_backfill_validators from "../storeBalance/backfill/validators.js";
import type * as storeBalance_funding_helpers from "../storeBalance/funding/helpers.js";
import type * as storeBalance_funding_internal_migrateActions from "../storeBalance/funding/internal/migrateActions.js";
import type * as storeBalance_funding_internal_migration from "../storeBalance/funding/internal/migration.js";
import type * as storeBalance_funding_internal_mutations from "../storeBalance/funding/internal/mutations.js";
import type * as storeBalance_funding_internal_queries from "../storeBalance/funding/internal/queries.js";
import type * as storeBalance_funding_internal_quiescence from "../storeBalance/funding/internal/quiescence.js";
import type * as storeBalance_funding_migration from "../storeBalance/funding/migration.js";
import type * as storeBalance_funding_public_queries from "../storeBalance/funding/public/queries.js";
import type * as storeBalance_ownership from "../storeBalance/ownership.js";
import type * as storeBalance_stripe from "../storeBalance/stripe.js";
import type * as storeBalance_workflow_internal_actions from "../storeBalance/workflow/internal/actions.js";
import type * as storeBalance_workflow_internal_provider from "../storeBalance/workflow/internal/provider.js";
import type * as storeBalance_workflow_internal_requests from "../storeBalance/workflow/internal/requests.js";
import type * as storeBalance_workflow_validators from "../storeBalance/workflow/validators.js";
import type * as storePlans_billing_helpers from "../storePlans/billing/helpers.js";
import type * as storePlans_billing_internal_mutations from "../storePlans/billing/internal/mutations.js";
import type * as storePlans_billing_internal_queries from "../storePlans/billing/internal/queries.js";
import type * as storePlans_billing_public_queries from "../storePlans/billing/public/queries.js";
import type * as storePlans_helpers from "../storePlans/helpers.js";
import type * as storePlans_internal_actions from "../storePlans/internal/actions.js";
import type * as storePlans_pricing_helpers from "../storePlans/pricing/helpers.js";
import type * as storePlans_pricing_internal_mutations from "../storePlans/pricing/internal/mutations.js";
import type * as storePlans_pricing_internal_queries from "../storePlans/pricing/internal/queries.js";
import type * as storePlans_pricing_public_actions from "../storePlans/pricing/public/actions.js";
import type * as storePlans_pricing_public_queries from "../storePlans/pricing/public/queries.js";
import type * as storePlans_public_actions from "../storePlans/public/actions.js";
import type * as storePlans_validators from "../storePlans/validators.js";
import type * as storefront_checkout from "../storefront/checkout.js";
import type * as storefront_helpers from "../storefront/helpers.js";
import type * as storefront_internal_queries from "../storefront/internal/queries.js";
import type * as storefront_public_queries from "../storefront/public/queries.js";
import type * as storefront_recipient from "../storefront/recipient.js";
import type * as stripe_client from "../stripe/client.js";
import type * as stripe_helpers from "../stripe/helpers.js";
import type * as stripe_http from "../stripe/http.js";
import type * as stripe_public_actions from "../stripe/public/actions.js";
import type * as stripe_public_queries from "../stripe/public/queries.js";
import type * as stripe_setup_actions from "../stripe/setup/actions.js";
import type * as stripe_triggerLog_mutations from "../stripe/triggerLog/mutations.js";
import type * as stripe_triggerLog_queries from "../stripe/triggerLog/queries.js";
import type * as stripe_webhooks from "../stripe/webhooks.js";
import type * as users_authorization from "../users/authorization.js";
import type * as users_queries from "../users/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  "accounts/actions": typeof accounts_actions;
  "accounts/helpers": typeof accounts_helpers;
  "accounts/queries": typeof accounts_queries;
  "admin/actions": typeof admin_actions;
  "admin/queries": typeof admin_queries;
  "admin/reset/actions": typeof admin_reset_actions;
  "admin/reset/mutations": typeof admin_reset_mutations;
  "admin/seed/actions": typeof admin_seed_actions;
  "admin/seed/helpers": typeof admin_seed_helpers;
  "admin/seed/mutations": typeof admin_seed_mutations;
  "adminTesting/actions": typeof adminTesting_actions;
  "adminTesting/helpers": typeof adminTesting_helpers;
  "adminTesting/queries": typeof adminTesting_queries;
  "affiliateDefaults/helpers": typeof affiliateDefaults_helpers;
  "affiliateDefaults/mutations": typeof affiliateDefaults_mutations;
  "affiliateDefaults/queries": typeof affiliateDefaults_queries;
  "affiliateRecovery/billingSandbox/actions": typeof affiliateRecovery_billingSandbox_actions;
  "affiliateRecovery/helpers": typeof affiliateRecovery_helpers;
  "affiliateRecovery/internal/queries": typeof affiliateRecovery_internal_queries;
  "affiliateRecovery/jobs/actions": typeof affiliateRecovery_jobs_actions;
  "affiliateRecovery/public/actions": typeof affiliateRecovery_public_actions;
  "affiliateRecovery/public/queries": typeof affiliateRecovery_public_queries;
  "affiliateRecovery/sandbox/actions": typeof affiliateRecovery_sandbox_actions;
  "billing/checkoutHistory": typeof billing_checkoutHistory;
  "billing/events/actions": typeof billing_events_actions;
  "billing/invoiceHistory": typeof billing_invoiceHistory;
  "billing/invoicePayments": typeof billing_invoicePayments;
  "billing/personalAccountMapping": typeof billing_personalAccountMapping;
  "billing/public/actions": typeof billing_public_actions;
  "billing/public/queries": typeof billing_public_queries;
  "billing/subscriptionLifecycle": typeof billing_subscriptionLifecycle;
  "checkoutExamples/actions": typeof checkoutExamples_actions;
  "checkoutExamples/queries": typeof checkoutExamples_queries;
  "connect/actions": typeof connect_actions;
  "connect/queries": typeof connect_queries;
  "connect/refundCommandEvidence": typeof connect_refundCommandEvidence;
  "connect/refundCommandNormalization": typeof connect_refundCommandNormalization;
  "connect/refundContext": typeof connect_refundContext;
  crons: typeof crons;
  "e2eCheckout/actions": typeof e2eCheckout_actions;
  "e2eMoney/actions": typeof e2eMoney_actions;
  "e2eMoney/helpers": typeof e2eMoney_helpers;
  "e2eMoney/queries": typeof e2eMoney_queries;
  "embeddedExamples/helpers": typeof embeddedExamples_helpers;
  "embeddedExamples/internal/queries": typeof embeddedExamples_internal_queries;
  "embeddedExamples/public/actions": typeof embeddedExamples_public_actions;
  http: typeof http;
  "marketplace/accountActions": typeof marketplace_accountActions;
  "marketplace/accountConfiguration": typeof marketplace_accountConfiguration;
  "marketplace/actions": typeof marketplace_actions;
  "marketplace/affiliateSplit": typeof marketplace_affiliateSplit;
  "marketplace/checkoutActions": typeof marketplace_checkoutActions;
  "marketplace/commission": typeof marketplace_commission;
  "marketplace/commissionMigration/mutations": typeof marketplace_commissionMigration_mutations;
  "marketplace/helpers": typeof marketplace_helpers;
  "marketplace/model": typeof marketplace_model;
  "marketplace/personaQueries": typeof marketplace_personaQueries;
  "marketplace/queries": typeof marketplace_queries;
  "payoutWorkers/actions": typeof payoutWorkers_actions;
  "payoutWorkers/helpers": typeof payoutWorkers_helpers;
  "payoutWorkers/scope/helpers": typeof payoutWorkers_scope_helpers;
  "payoutWorkers/scope/queries": typeof payoutWorkers_scope_queries;
  "products/actions": typeof products_actions;
  "products/queries": typeof products_queries;
  "readContracts/queries": typeof readContracts_queries;
  "recipientPayouts/helpers": typeof recipientPayouts_helpers;
  "recipientPayouts/internal/queries": typeof recipientPayouts_internal_queries;
  "recipientPayouts/policy/actions": typeof recipientPayouts_policy_actions;
  "recipientPayouts/policy/helpers": typeof recipientPayouts_policy_helpers;
  "recipientPayouts/policyView": typeof recipientPayouts_policyView;
  "recipientPayouts/public/actions": typeof recipientPayouts_public_actions;
  "sandboxFixtures/helpers": typeof sandboxFixtures_helpers;
  "sandboxFixtures/internal/actions": typeof sandboxFixtures_internal_actions;
  "sandboxFixtures/plan": typeof sandboxFixtures_plan;
  "sandboxFixtures/public/actions": typeof sandboxFixtures_public_actions;
  "sandboxFixtures/renewalPurchase": typeof sandboxFixtures_renewalPurchase;
  "sandboxFixtures/renewals/actions": typeof sandboxFixtures_renewals_actions;
  "sandboxFixtures/renewals/helpers": typeof sandboxFixtures_renewals_helpers;
  "sandboxFixtures/renewals/mutations": typeof sandboxFixtures_renewals_mutations;
  "sandboxFixtures/renewals/queries": typeof sandboxFixtures_renewals_queries;
  "sandboxFixtures/resources": typeof sandboxFixtures_resources;
  "sandboxFixtures/state/helpers": typeof sandboxFixtures_state_helpers;
  "sandboxFixtures/state/internal/mutations": typeof sandboxFixtures_state_internal_mutations;
  "sandboxFixtures/state/internal/queries": typeof sandboxFixtures_state_internal_queries;
  "sandboxFixtures/state/public/queries": typeof sandboxFixtures_state_public_queries;
  "sellerAffiliateRates/helpers": typeof sellerAffiliateRates_helpers;
  "sellerAffiliateRates/internal/queries": typeof sellerAffiliateRates_internal_queries;
  "sellerAffiliateRates/public/mutations": typeof sellerAffiliateRates_public_mutations;
  "sellerAffiliateRates/public/queries": typeof sellerAffiliateRates_public_queries;
  "sellerCosts/actions": typeof sellerCosts_actions;
  "sellerCosts/billing/internal/mutations": typeof sellerCosts_billing_internal_mutations;
  "sellerCosts/billing/public/queries": typeof sellerCosts_billing_public_queries;
  "sellerCosts/helpers": typeof sellerCosts_helpers;
  "sellerCosts/invoiceRecoverySource": typeof sellerCosts_invoiceRecoverySource;
  "sellerCosts/invoices/actions": typeof sellerCosts_invoices_actions;
  "sellerCosts/invoices/helpers": typeof sellerCosts_invoices_helpers;
  "sellerCosts/migration/mutations": typeof sellerCosts_migration_mutations;
  "sellerCosts/migration/queries": typeof sellerCosts_migration_queries;
  "sellerCosts/recovery": typeof sellerCosts_recovery;
  "sellerCosts/recoveryInvoices/actions": typeof sellerCosts_recoveryInvoices_actions;
  "sellerCosts/recoveryInvoices/mutations": typeof sellerCosts_recoveryInvoices_mutations;
  "sellerCosts/recoveryInvoices/workflow/actions": typeof sellerCosts_recoveryInvoices_workflow_actions;
  "sellerCosts/recoveryInvoices/workflow/mutations": typeof sellerCosts_recoveryInvoices_workflow_mutations;
  "sellerCosts/unsettledCostSource": typeof sellerCosts_unsettledCostSource;
  "sellerCosts/validators": typeof sellerCosts_validators;
  "sellerCosts/workflow/actions": typeof sellerCosts_workflow_actions;
  "sellerCosts/workflow/helpers": typeof sellerCosts_workflow_helpers;
  "sellerCosts/workflow/mutations": typeof sellerCosts_workflow_mutations;
  "sellerCosts/workflow/queries": typeof sellerCosts_workflow_queries;
  "sellerCosts/workflow/validators": typeof sellerCosts_workflow_validators;
  "settlement/internal/actions": typeof settlement_internal_actions;
  "settlement/internal/mutations": typeof settlement_internal_mutations;
  "settlement/internal/queries": typeof settlement_internal_queries;
  "settlement/public/queries": typeof settlement_public_queries;
  "settlement/recovery": typeof settlement_recovery;
  "settlement/workflow/actions": typeof settlement_workflow_actions;
  "settlement/workflow/helpers": typeof settlement_workflow_helpers;
  "settlement/workflow/mutations": typeof settlement_workflow_mutations;
  "storeBalance/actions": typeof storeBalance_actions;
  "storeBalance/backfill/actions": typeof storeBalance_backfill_actions;
  "storeBalance/backfill/mutations": typeof storeBalance_backfill_mutations;
  "storeBalance/backfill/queries": typeof storeBalance_backfill_queries;
  "storeBalance/backfill/validators": typeof storeBalance_backfill_validators;
  "storeBalance/funding/helpers": typeof storeBalance_funding_helpers;
  "storeBalance/funding/internal/migrateActions": typeof storeBalance_funding_internal_migrateActions;
  "storeBalance/funding/internal/migration": typeof storeBalance_funding_internal_migration;
  "storeBalance/funding/internal/mutations": typeof storeBalance_funding_internal_mutations;
  "storeBalance/funding/internal/queries": typeof storeBalance_funding_internal_queries;
  "storeBalance/funding/internal/quiescence": typeof storeBalance_funding_internal_quiescence;
  "storeBalance/funding/migration": typeof storeBalance_funding_migration;
  "storeBalance/funding/public/queries": typeof storeBalance_funding_public_queries;
  "storeBalance/ownership": typeof storeBalance_ownership;
  "storeBalance/stripe": typeof storeBalance_stripe;
  "storeBalance/workflow/internal/actions": typeof storeBalance_workflow_internal_actions;
  "storeBalance/workflow/internal/provider": typeof storeBalance_workflow_internal_provider;
  "storeBalance/workflow/internal/requests": typeof storeBalance_workflow_internal_requests;
  "storeBalance/workflow/validators": typeof storeBalance_workflow_validators;
  "storePlans/billing/helpers": typeof storePlans_billing_helpers;
  "storePlans/billing/internal/mutations": typeof storePlans_billing_internal_mutations;
  "storePlans/billing/internal/queries": typeof storePlans_billing_internal_queries;
  "storePlans/billing/public/queries": typeof storePlans_billing_public_queries;
  "storePlans/helpers": typeof storePlans_helpers;
  "storePlans/internal/actions": typeof storePlans_internal_actions;
  "storePlans/pricing/helpers": typeof storePlans_pricing_helpers;
  "storePlans/pricing/internal/mutations": typeof storePlans_pricing_internal_mutations;
  "storePlans/pricing/internal/queries": typeof storePlans_pricing_internal_queries;
  "storePlans/pricing/public/actions": typeof storePlans_pricing_public_actions;
  "storePlans/pricing/public/queries": typeof storePlans_pricing_public_queries;
  "storePlans/public/actions": typeof storePlans_public_actions;
  "storePlans/validators": typeof storePlans_validators;
  "storefront/checkout": typeof storefront_checkout;
  "storefront/helpers": typeof storefront_helpers;
  "storefront/internal/queries": typeof storefront_internal_queries;
  "storefront/public/queries": typeof storefront_public_queries;
  "storefront/recipient": typeof storefront_recipient;
  "stripe/client": typeof stripe_client;
  "stripe/helpers": typeof stripe_helpers;
  "stripe/http": typeof stripe_http;
  "stripe/public/actions": typeof stripe_public_actions;
  "stripe/public/queries": typeof stripe_public_queries;
  "stripe/setup/actions": typeof stripe_setup_actions;
  "stripe/triggerLog/mutations": typeof stripe_triggerLog_mutations;
  "stripe/triggerLog/queries": typeof stripe_triggerLog_queries;
  "stripe/webhooks": typeof stripe_webhooks;
  "users/authorization": typeof users_authorization;
  "users/queries": typeof users_queries;
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

export const components = componentsGeneric() as unknown as {
  betterStripe: import("@fantastic.dev/better-stripe/_generated/component.js").ComponentApi<"betterStripe">;
};
