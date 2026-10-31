import { expect, vi } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  observerIdentity,
  authorizeObservation,
  readerControls,
} from "../test-fixtures/observationReader.js";
import {
  prepareInvoiceObservation,
  authorizeInvoices,
  invoiceControls,
} from "../test-fixtures/invoiceObservation.js";
import {
  captureFreshInvoiceRenewalObservation,
  captureFreshRenewalObservation,
} from "./freshActor.js";

let fetchHook: null | ((path: string, method: string) => Promise<void>) = null;
const options = {
  identity: observerIdentity,
  hostQuery: authorizeObservation,
  hostInvoiceQuery: authorizeInvoices,
  beforeFetch: async (path: string, method: string) => {
    await fetchHook?.(path, method);
  },
};
async function prepare(h: Parameters<typeof prepareInvoiceObservation>[0]) {
  fetchHook = null;
  return prepareInvoiceObservation(h);
}
type State = Awaited<ReturnType<typeof prepare>>;
type Harness = Parameters<typeof prepare>[0];
async function observe(h: Harness, state: State) {
  let result: Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof captureFreshInvoiceRenewalObservation>
      >["invoke"]
    >
  > | null = null;
  await h.inAnotherAction(async (ctx) => {
    const actor = await captureFreshInvoiceRenewalObservation(h.sdk, {
      actualActionCtx: ctx,
      operationId: state.operationId,
      parentOperationId: state.parentOperationId,
    });
    result = await actor.invoke();
  });
  // Assigned by the joined real Action continuation.
  if (result === null) throw Error("NO_RESULT");
  return result as Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof captureFreshInvoiceRenewalObservation>
      >["invoke"]
    >
  >;
}

const controls = [
  "missing",
  "equal",
  "deleted",
  "malformed",
  "foreign-mode",
  "foreign-account",
  "foreign-body",
  "foreign-parent",
  "foreign-customer",
  "wrong-url",
  "duplicate",
  "cursor-injection",
  "oversize",
  "empty-continuation",
  "second-overflow",
  "fence-drift",
  "foreign-line-cursor",
  "cross-invoice-line-alias",
] as const;
for (const control of controls)
  configureAdmissionCase(
    "invoice acquisition refusal: " + control,
    prepare,
    async (h, state) => {
      const before = h.calls.length;
      const first = state.inventories[0];
      let extra = 0;
      if (control === "missing") state.reads.subscription.latest_invoice = null;
      if (control === "equal")
        state.reads.subscription.latest_invoice = "in_original";
      if (control === "deleted")
        state.reads.subscription.latest_invoice = {
          id: "in_current",
          object: "invoice",
          deleted: true,
        };
      if (control === "malformed")
        state.reads.subscription.latest_invoice = "in_current/../foreign";
      if (control === "foreign-mode")
        state.reads.subscription.latest_invoice = {
          id: "in_current",
          object: "invoice",
          livemode: true,
        };
      if (control === "foreign-account")
        state.reads.subscription.latest_invoice = {
          id: "in_current",
          object: "invoice",
          customer_account: "acct_foreign",
        };
      if (control === "foreign-body") {
        first.invoice.customer_account = "acct_foreign";
        extra = 1;
      }
      if (control === "foreign-parent") {
        first.invoice.parent.subscription_details.subscription = "sub_foreign";
        extra = 1;
      }
      if (control === "foreign-customer") {
        first.invoice.customer = "cus_foreign";
        extra = 1;
      }
      if (control === "wrong-url") {
        first.page.url = "https://foreign.test/lines";
        extra = 2;
      }
      if (control === "duplicate") {
        first.page.data.push(structuredClone(first.page.data[0]));
        extra = 2;
      }
      if (control === "cursor-injection") {
        first.page.data[0].id = "il_bad&limit=1000";
        first.page.has_more = true;
        extra = 2;
      }
      if (control === "oversize") {
        first.page.data = Array.from({ length: 101 }, (_, i) => ({
          ...first.page.data[0],
          id: "il_" + i,
        }));
        extra = 2;
      }
      if (control === "empty-continuation") {
        first.page.data = [];
        first.page.has_more = true;
        extra = 2;
      }
      if (control === "second-overflow") {
        first.page.has_more = true;
        h.setControlledRead(
          "/v1/invoices/in_original/lines?limit=100&starting_after=il_original",
          { ...first.page, data: [{ ...first.page.data[0], id: "il_next" }] },
        );
        extra = 3;
      }
      if (control === "foreign-line-cursor") {
        first.page.data[0].invoice = "in_foreign";
        first.page.has_more = true;
        extra = 2;
      }
      if (control === "cross-invoice-line-alias") {
        state.inventories[1].page.data[0].id = first.page.data[0].id;
        extra = 4;
      }
      if (control === "fence-drift") {
        let subs = 0;
        fetchHook = async (path) => {
          if (path === "/v1/subscriptions/sub_original" && ++subs === 2)
            state.reads.subscription.description = "FENCE_DRIFT";
        };
        extra = 5;
      }
      const result = await observe(h, state);
      expect(result.invoiceContext).toBeNull();
      expect(["unavailable", "conflict"]).toContain(result.invoiceInventory);
      expect(result.invoiceReason).toBeTypeOf("string");
      expect(result.evidence?.invoiceEvidence.predicate).not.toBe(
        "invoice_lines_correlated",
      );
      expect(h.calls.slice(before)).toHaveLength(6 + extra);
      expect(
        h.calls
          .slice(before)
          .every(
            (c) =>
              c.method === "GET" && !c.hasBody && c.idempotencyKey === null,
          ),
      ).toBe(true);
    },
    options,
  );

for (const role of ["original", "both", "maximum"] as const)
  configureAdmissionCase(
    "bounded complete second pages: " + role,
    prepare,
    async (h, state) => {
      const before = h.calls.length;
      if (role === "maximum") {
        const sub = state.reads.subscription;
        for (const [owner, level] of [
          [sub, "sub"],
          [sub.items.data[0], "item"],
        ] as const) {
          const original = owner.discounts[0];
          owner.discounts = Array.from({ length: 19 }, (_, i) => {
            const discount = structuredClone(original);
            discount.id = "di_" + level + i;
            discount.source.coupon.id = "maximum-" + level + i;
            h.setControlledRead(
              "/v1/coupons/" + discount.source.coupon.id,
              discount.source.coupon,
            );
            return discount;
          });
        }
      }
      for (const index of role === "original" ? [0] : [0, 1]) {
        const { page, invoice } = state.inventories[index];
        const line = page.data[0];
        const addon = {
          ...structuredClone(line),
          id: "il_extra_" + index,
          parent: {
            type: "invoice_item_details",
            subscription_item_details: null,
            invoice_item_details: { invoice_item: "ii_extra" },
          },
        };
        Object.assign(page, { has_more: true, data: [addon] });
        h.setControlledRead(
          `/v1/invoices/${invoice.id}/lines?limit=100&starting_after=${addon.id}`,
          { ...page, has_more: false, data: [line] },
        );
      }
      const result = await observe(h, state);
      expect(result.invoiceInventory).toBe("complete");
      expect(result.evidence?.invoiceEvidence.predicate).toBe(
        "invoice_lines_correlated",
      );
      expect(result.invoiceContext?.original.linePages).toHaveLength(2);
      expect(Object.isFrozen(result.invoiceContext?.original.linePages)).toBe(
        true,
      );
      const calls = h.calls.slice(before);
      expect(calls).toHaveLength(
        role === "maximum" ? 51 : role === "both" ? 13 : 12,
      );
      expect(
        calls.filter((c) => c.query.includes("starting_after")).length,
      ).toBe(role === "original" ? 1 : 2);
    },
    options,
  );

for (let denied = 1; denied <= 6; denied++)
  configureAdmissionCase(
    "invoice capability revocation at authorization " + denied,
    prepare,
    async (h, state) => {
      invoiceControls.reply = (grant) =>
        invoiceControls.count >= denied ? null : grant;
      const before = h.calls.length;
      await expect(observe(h, state)).rejects.toThrow();
      expect(h.calls.slice(before)).toHaveLength(6 + denied - 1);
      expect(invoiceControls.count).toBe(denied);
    },
    options,
  );

for (const control of [
  "base-revoked",
  "subject",
  "customer",
  "revision",
  "extra-field",
  "expiry",
  "profile-removed",
] as const)
  configureAdmissionCase(
    "invoice grant guard: " + control,
    prepare,
    async (h, state) => {
      const before = h.calls.length;
      let extra = 0;
      if (control === "base-revoked") {
        readerControls.reply = (grant) =>
          invoiceControls.count > 0 ? null : grant;
        extra = 1;
      }
      if (control === "subject")
        invoiceControls.reply = (grant) => ({
          ...grant,
          tokenIdentifier: "foreign",
        });
      if (control === "customer")
        invoiceControls.reply = (grant) => ({
          ...grant,
          providerScope: {
            ...(invoiceControls.args.providerScope as object),
            customerId: "cus_foreign",
          },
        });
      if (control === "revision") {
        invoiceControls.reply = (grant) => ({
          ...grant,
          authorizationRevision: invoiceControls.count > 1 ? 2 : 1,
        });
        extra = 1;
      }
      if (control === "extra-field")
        invoiceControls.reply = (grant) => ({ ...grant, extra: true });
      if (control === "expiry") {
        invoiceControls.grant.expiresAtMs = Date.now() + 100;
        fetchHook = async (path) => {
          if (path === "/v1/invoices/in_original")
            vi.setSystemTime(Date.now() + 100);
        };
        extra = 1;
      }
      if (control === "profile-removed") {
        fetchHook = async (path) => {
          if (path === "/v1/invoices/in_original")
            admissionControls.invoices.splice(0);
        };
        extra = 1;
      }
      await expect(observe(h, state)).rejects.toThrow();
      expect(h.calls.slice(before)).toHaveLength(6 + extra);
    },
    options,
  );

for (const revoked of [false, true])
  configureAdmissionCase(
    "actual invoice SDK rejection, final grant revoked=" + revoked,
    prepare,
    async (h, state) => {
      const before = h.calls.length;
      fetchHook = async (path) => {
        if (path === "/v1/invoices/in_original") {
          if (revoked) invoiceControls.deny = true;
          throw Error("CONTROLLED_REJECT");
        }
      };
      if (revoked) await expect(observe(h, state)).rejects.toThrow();
      else {
        const result = await observe(h, state);
        expect(result.status).toBe("observation_provider_rejected");
        expect(result.failure?.resource).toBe("invoice");
        expect(result.failure?.outcome).toBe("unknown");
        expect(result.history.attachmentReceipt.scheduleId).toBe(
          "sub_sched_owned",
        );
        expect(result.reads).toBeNull();
        expect(result.invoiceContext).toBeNull();
      }
      expect(h.calls.slice(before)).toHaveLength(7);
    },
    options,
  );

configureAdmissionCase(
  "invoice grant does not expand the original base observer profile",
  prepare,
  async (h, state) => {
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(
        Object.prototype.hasOwnProperty.call(result, "invoiceContext"),
      ).toBe(false);
      expect(result.evidence?.invoiceEvidence.reason).toBe("not_supplied");
    });
    expect(h.calls.slice(before)).toHaveLength(6);
    expect(invoiceControls.count).toBe(0);
  },
  options,
);

for (const mode of [
  "minimal-expanded",
  "full-expanded",
  "decimal",
  "currency",
  "proration",
] as const)
  configureAdmissionCase(
    "invoice wire material: " + mode,
    prepare,
    async (h, state) => {
      const current = state.inventories[1];
      if (mode === "minimal-expanded")
        state.reads.subscription.latest_invoice = {
          id: current.invoice.id,
          object: "invoice",
        };
      if (mode === "full-expanded")
        state.reads.subscription.latest_invoice = structuredClone(
          current.invoice,
        );
      if (mode === "decimal") {
        current.page.data[0].quantity_decimal = "3.000";
        current.page.data[0].pricing.unit_amount_decimal = "2000.000000000000";
      }
      if (mode === "currency") current.page.data[0].currency = "eur";
      if (mode === "proration")
        current.page.data[0].parent.subscription_item_details.proration = true;
      const result = await observe(h, state);
      expect(result.invoiceInventory).toBe("complete");
      expect(result.evidence?.invoiceEvidence.predicate).toBe(
        mode === "currency"
          ? "conflict"
          : mode === "proration"
            ? "unknown"
            : "invoice_lines_correlated",
      );
      if (mode === "decimal")
        expect(
          result.evidence?.invoiceEvidence.current?.unitAmountDecimal,
        ).toBe("2000.000000000000");
    },
    options,
  );

configureAdmissionCase(
  "invoice acquisition preserves genuine optional weekly configure acknowledgement",
  (h) => {
    fetchHook = null;
    return prepareInvoiceObservation(h, { retained: true });
  },
  async (h, state) => {
    const result = await observe(h, state);
    expect(result.history.configureReceipt).not.toBeNull();
    expect(result.evidence?.invoiceEvidence.predicate).toBe(
      "invoice_lines_correlated",
    );
    expect(result.evidence?.currentMaterial.predicate).toBe(
      "current_target_material_match",
    );
    expect(result.evidence?.acknowledgementEstablished).toBe(false);
  },
  { ...options, targetInterval: "week" },
);

configureAdmissionCase(
  "one original timeout closes a hanging invoice GET and denies late release",
  prepare,
  async (h, state) => {
    const before = h.calls.length;
    let release!: () => void, notify!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notify = resolve;
    });
    fetchHook = async (path) => {
      if (path === "/v1/invoices/in_original") {
        notify();
        await held;
      }
    };
    await h.inAnotherAction(async (ctx) => {
      const actor = await captureFreshInvoiceRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const pending = actor.invoke();
      const rejected = expect(pending).rejects.toThrow(
        "OBSERVATION_HISTORY_READER_EXPIRED",
      );
      await started;
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      const authorizations = invoiceControls.count;
      fetchHook = null;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(invoiceControls.count).toBe(authorizations);
      await expect(actor.invoke()).rejects.toThrow();
    });
    expect(h.calls.slice(before)).toHaveLength(7);
  },
  options,
);
