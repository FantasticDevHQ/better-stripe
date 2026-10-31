import { makeFunctionReference } from "convex/server";
import {
  configureComponentFixture,
  canonicalConfigure,
} from "../../src/component/renewalOperations/configureJournal.fixtures.js";
import { canonicalJournalEvent } from "../../src/shared/renewalOperationJournal.js";
import { constructRenewalConfigurationReceiptV2 } from "../../src/client/billing/renewalV2/index.js";

// Synthetic complete native DATA, not provider execution or historical provenance.
export async function witnessFixture(
  retained = false,
  options: { sourcePadding?: string } = {},
) {
  const h = await configureComponentFixture(true, {
    targetInterval: "week",
    ...options,
  });
  const created = await h.t.mutation(h.create, h.createArgs);
  const reserved = await h.t.mutation(h.reserve, {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "configure",
    expectedRequestBinding: h.request.requestIdentity.binding,
    recordJSON: h.createArgs.recordJSON,
  });
  const configuration = JSON.parse(h.createArgs.recordJSON).configureRecord
    .configuration;
  const schedule = structuredClone(configuration.schedule);
  const current = schedule.phases[0],
    target = structuredClone(current);
  Object.assign(target, {
    start_date: current.end_date,
    end_date: 1771718400,
    billing_cycle_anchor: "phase_start",
    proration_behavior: "none",
  });
  Object.assign(target.items[0], {
    price: "price_target",
    plan: "price_target",
  });
  schedule.phases = [current, target];
  schedule.current_phase = {
    start_date: target.start_date,
    end_date: target.end_date,
  };
  const subscription = structuredClone(configuration.freshSubscription);
  const item = subscription.items.data[0],
    price = configuration.targetPrice;
  item.id = "si_successor";
  item.price = structuredClone(price);
  Object.assign(item.plan, {
    id: price.id,
    amount: price.unit_amount,
    amount_decimal: price.unit_amount_decimal,
    product: price.product,
    metadata: price.metadata,
    nickname: price.nickname,
    interval: price.recurring.interval,
    interval_count: price.recurring.interval_count,
  });
  Object.assign(item, {
    current_period_start: target.start_date,
    current_period_end: target.end_date,
  });
  for (const discount of item.discounts) discount.subscription_item = item.id;
  subscription.billing_cycle_anchor = target.start_date;
  const reads = {
    schedule,
    subscription,
    targetPrice: structuredClone(price),
    billingCustomer: structuredClone(configuration.billingCustomer),
    coupons: [
      configuration.preparation.subscription.discounts[0].source.coupon,
      configuration.preparation.subscription.items.data[0].discounts[0].source
        .coupon,
    ],
  };
  async function retainConfigure(retain = true) {
    await h.t.mutation(h.bind, {
      operationId: created.operationId,
      attemptId: reserved.reservation.attemptId,
      policyJSON: canonicalConfigure(h.record.timingPolicy),
      basisJSON: canonicalConfigure(h.basis),
    });
    const body = {
      ...structuredClone(schedule),
      current_phase: structuredClone(configuration.schedule.current_phase),
    };
    const transport = { status: 200, requestId: "req_witness_synthetic_C9" };
    const raw = {
      configuration,
      actualDispatch: { ...h.record.dispatch, payload: h.request.payload },
      providerSnapshot: body,
      transport,
    };
    const receipt = await constructRenewalConfigurationReceiptV2(raw);
    const events = [
      { event: "dispatch", stage: "configure", request: h.request },
      {
        event: "response",
        stage: "configure",
        request: h.request,
        body,
        transport,
      },
    ];
    for (const [index, data] of events.entries()) {
      const event = await canonicalJournalEvent(
        index + 1,
        canonicalConfigure(data),
      );
      await h.t.mutation(h.append, {
        reservation: reserved.reservation,
        expectedSequence: index,
        event: {
          sequence: index + 1,
          binding: event.binding,
          dataJSON: event.json,
        },
      });
    }
    if (retain)
      await h.t.mutation(h.retain, {
        operationId: created.operationId,
        attemptId: reserved.reservation.attemptId,
        expectedSequence: 2,
        receiptJSON: canonicalConfigure(receipt),
      });
    return raw;
  }
  const rawConfigureReceipt = retained ? await retainConfigure() : null;
  const ack = makeFunctionReference<"query">(
    "renewalOperations/queries:readProviderAcknowledgement",
  );
  async function sourceStage(operationId: string, parent: boolean) {
    const loaded = await h.t.query(h.load, { operationId });
    const acknowledgement = await h.t.query(ack, { operationId });
    return {
      record: JSON.parse(loaded.recordJSON),
      reservation: loaded.activeAttempt,
      ...(parent ? { initialBasis: loaded.initialBasis } : {}),
      acknowledgement:
        acknowledgement === null
          ? null
          : {
              retention: acknowledgement.retention,
              receipt: JSON.parse(acknowledgement.receiptJSON),
            },
    };
  }
  const identity = {
    componentScope: "witness-installation",
    witnessId: "native-target-1",
    parentOperationId: h.parentCreated.operationId,
    operationId: created.operationId,
  };
  const payload = {
    version: 1,
    kind: "renewal_witness_payload",
    identity,
    capturedSubject: "https://host.test|observer",
    acquisition: {
      observedAtMs: target.start_date * 1000 + 1000,
      elapsedWallMs: 10,
      elapsedNsDecimal: "10000000",
      apiVersion: "2026-09-30.endive",
      baseReadProfile: "endive-schedule-first-44-v1",
      invoiceReadProfile: null,
    },
    source: {
      parent: await sourceStage(identity.parentOperationId, true),
      configure: await sourceStage(identity.operationId, false),
    },
    reads,
    invoiceContext: null,
  };
  return {
    ...h,
    created,
    reserved,
    configuration,
    payload,
    identity,
    rawConfigureReceipt,
    retainConfigure,
  };
}

/** Synthetic exact paired billing context for the already constructed source. */
export function addWitnessInvoices(
  h: Awaited<ReturnType<typeof witnessFixture>>,
) {
  const { payload, configuration } = h;
  const old = configuration.preparation.subscription;
  const current = payload.reads.subscription;
  current.latest_invoice = "in_current";
  const inventory = (original: boolean) => {
    const sub = original ? old : current;
    const item = sub.items.data[0],
      price = item.price;
    const id = original ? "in_original" : "in_current";
    return {
      invoice: {
        id,
        object: "invoice",
        customer_account: "acct_buyer",
        customer: "cus_buyer",
        livemode: false,
        currency: "usd",
        status: "open",
        billing_reason: "subscription_cycle",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_original" },
        },
        futureInvoice: { preserved: null },
      },
      linePages: [
        {
          object: "list",
          url: `/v1/invoices/${id}/lines`,
          has_more: false,
          data: [
            {
              id: original ? "il_original" : "il_current",
              object: "line_item",
              invoice: id,
              livemode: false,
              currency: "usd",
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
                unit_amount_decimal:
                  String(price.unit_amount_decimal) + ".000000000000",
              },
              period: {
                start: item.current_period_start,
                end: item.current_period_end,
              },
              quantity: item.quantity,
              quantity_decimal: String(item.quantity) + ".000",
              futureLine: [null, "retained"],
            },
          ],
        },
      ],
    };
  };
  Reflect.set(payload, "invoiceContext", {
    original: inventory(true),
    current: inventory(false),
  });
  Reflect.set(
    payload.acquisition,
    "invoiceReadProfile",
    "endive-pinned-invoices-fence-7-v1",
  );
}
