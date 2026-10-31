import { makeFunctionReference, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { isDeepStrictEqual } from "node:util";
import { prepareFreshObservation } from "./freshObservation.js";
import { admissionControls } from "./producerConfigureAdmission.js";
import { observerIdentity } from "./observationReader.js";

export const invoiceControls = {
  args: {} as Record<string, unknown>,
  grant: {} as Record<string, unknown>,
  count: 0,
  deny: false,
  reply: null as null | ((grant: Record<string, unknown>) => unknown),
};
export const authorizeInvoices = queryGeneric({
  args: {
    capability: v.literal("renewal_invoice_evidence_v1"),
    componentScope: v.string(),
    parentOperationId: v.string(),
    operationId: v.string(),
    providerScope: v.object({
      mode: v.literal("platform"),
      stripeAccount: v.null(),
      livemode: v.boolean(),
      customerAccountId: v.string(),
      customerId: v.string(),
      subscriptionId: v.string(),
      scheduleId: v.string(),
    }),
    originalInvoiceId: v.string(),
    currentInvoiceId: v.string(),
  },
  handler: async (ctx, args) => {
    invoiceControls.count++;
    const who = await ctx.auth.getUserIdentity();
    if (
      who?.tokenIdentifier !== observerIdentity.tokenIdentifier ||
      invoiceControls.deny ||
      !isDeepStrictEqual(args, invoiceControls.args)
    )
      return null;
    const grant = structuredClone(invoiceControls.grant);
    return invoiceControls.reply ? invoiceControls.reply(grant) : grant;
  },
});
export async function prepareInvoiceObservation(
  h: Parameters<typeof prepareFreshObservation>[0],
  options: { retained?: boolean } = {},
) {
  const state = await prepareFreshObservation(h, {
    active: true,
    retained: options.retained,
  });
  const configuration = JSON.parse(state.full.configure.operation.recordJSON)
    .configureRecord.configuration;
  const old = configuration.preparation.subscription;
  const current = state.reads.subscription;
  current.latest_invoice = "in_current";
  const line = (original: boolean) => {
    const sub = original ? old : current;
    const item = sub.items.data[0];
    const price = item.price;
    return {
      id: original ? "il_original" : "il_current",
      object: "line_item",
      invoice: original ? "in_original" : "in_current",
      livemode: false,
      currency: price.currency,
      parent: {
        type: "subscription_item_details",
        invoice_item_details: null,
        subscription_item_details: {
          subscription: sub.id,
          subscription_item: item.id,
          proration: false,
        },
      },
      pricing: {
        type: "price_details",
        price_details: { price: price.id, product: price.product },
        unit_amount_decimal: price.unit_amount_decimal,
      },
      period: {
        start: item.current_period_start,
        end: item.current_period_end,
      },
      quantity: item.quantity,
      quantity_decimal: String(item.quantity),
      wire_unknown: { retained: true },
    };
  };
  const inventories = ([true, false] as const).map((original) => {
    const id = original ? "in_original" : "in_current";
    const invoice = {
      id,
      object: "invoice",
      customer: "cus_buyer",
      customer_account: "acct_buyer",
      livemode: false,
      currency: "usd",
      status: "open",
      billing_reason: "subscription_cycle",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_original" },
      },
      wire_unknown: { retained: true },
    };
    const page = {
      object: "list",
      url: `/v1/invoices/${id}/lines`,
      has_more: false,
      data: [line(original)],
      wire_unknown: 42,
    };
    h.setControlledRead(`/v1/invoices/${id}`, invoice);
    h.setControlledRead(`/v1/invoices/${id}/lines`, page);
    return { invoice, page };
  });
  invoiceControls.args = {
    capability: "renewal_invoice_evidence_v1",
    componentScope: state.entry.componentScope,
    parentOperationId: state.parentOperationId,
    operationId: state.operationId,
    providerScope: {
      mode: "platform",
      stripeAccount: null,
      livemode: false,
      customerAccountId: "acct_buyer",
      customerId: "cus_buyer",
      subscriptionId: "sub_original",
      scheduleId: "sub_sched_owned",
    },
    originalInvoiceId: "in_original",
    currentInvoiceId: "in_current",
  };
  invoiceControls.grant = {
    ...invoiceControls.args,
    tokenIdentifier: observerIdentity.tokenIdentifier,
    authorizationId: "invoice-grant",
    authorizationRevision: 1,
    expiresAtMs: Date.now() + 60000,
  };
  invoiceControls.count = 0;
  invoiceControls.deny = false;
  invoiceControls.reply = null;
  const profile = Object.freeze({
    freshProfile: state.profile,
    readProfile: "endive-pinned-invoices-fence-7-v1",
    authorizationQuery: makeFunctionReference("initialOwner:authorizeInvoices"),
  });
  admissionControls.invoices.splice(
    0,
    admissionControls.invoices.length,
    profile,
  );
  return { ...state, invoiceProfile: profile, inventories };
}
