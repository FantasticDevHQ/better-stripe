export function meteringFixture() {
  const calls = [];
  const method =
    (name, result) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof result === "function" ? result(...args) : result;
    };
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: method("account.create", {
            id: "acct_private",
            livemode: false,
          }),
        },
      },
    },
    customers: {
      retrieve: method("customer.retrieve", {
        id: "cus_private",
        customer_account: "acct_private",
        livemode: false,
      }),
    },
    products: {
      create: method("product.create", { id: "prod_private", livemode: false }),
      update: method("product.update", {}),
    },
    prices: {
      create: method("price.create", { id: "price_private", livemode: false }),
      update: method("price.update", {}),
    },
    subscriptions: {
      create: method("subscription.create", {
        id: "sub_private",
        customer_account: "acct_private",
        customer: "cus_private",
        livemode: false,
      }),
      cancel: method("subscription.cancel", {}),
    },
    invoices: {
      createPreview: method("preview", {
        customer_account: "acct_private",
        currency: "usd",
        total: 0,
        livemode: false,
      }),
    },
    billing: {
      meters: {
        create: method("meter.create", { id: "mtr_private", livemode: false }),
        deactivate: method("meter.deactivate", {}),
        listEventSummaries: method("summaries", {
          data: [{ aggregated_value: 15 }],
        }),
      },
      meterEvents: {
        create: method("event.create", {
          livemode: false,
          identifier: "event_private",
        }),
      },
      creditGrants: {
        create: method("credit.create", {
          id: "cred_private",
          customer_account: "acct_private",
          livemode: false,
        }),
        expire: method("credit.expire", {}),
      },
    },
  };
  return { calls, stripe };
}
