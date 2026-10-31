import { expect, it } from "vitest";
import { anyApi } from "convex/server";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  observerIdentity,
  authorizeObservation,
} from "../test-fixtures/observationReader.js";
import {
  prepareInvoiceObservation,
  authorizeInvoices,
  invoiceControls,
} from "../test-fixtures/invoiceObservation.js";

import * as actors from "./freshActor.js";

const options = {
  identity: observerIdentity,
  hostQuery: authorizeObservation,
  hostInvoiceQuery: authorizeInvoices,
};

it("EMPTY invoice profile refuses before input reflection", async () => {
  admissionControls.invoices.splice(0);
  const capture = Reflect.get(actors, "captureFreshInvoiceRenewalObservation");
  expect(capture).toBeTypeOf("function");
  let traps = 0;
  const poison = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error("TRAP");
      },
      getPrototypeOf() {
        traps++;
        throw Error("TRAP");
      },
    },
  );
  await expect(capture(poison, poison)).rejects.toThrow(
    "INVOICE_OBSERVATION_UNBOUND",
  );
  expect(traps).toBe(0);
});
configureAdmissionCase(
  "fresh invoice acquisition correlates pinned periods and successor without C9",
  prepareInvoiceObservation,
  async (h, state) => {
    const capture = Reflect.get(
      actors,
      "captureFreshInvoiceRenewalObservation",
    );
    expect(capture).toBeTypeOf("function");
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const actor = await capture(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(result.invoiceInventory).toBe("complete");
      expect(result.invoiceContext?.original.invoice).toEqual(
        state.inventories[0].invoice,
      );
      expect(result.evidence?.invoiceEvidence.predicate).toBe(
        "invoice_lines_correlated",
      );
      expect(result.evidence?.currentMaterial.predicate).toBe(
        "current_target_material_match",
      );
      expect(result.evidence?.invoiceEvidence.current?.subscriptionItemId).toBe(
        "si_successor",
      );
      expect(result.evidence?.operationalAuthority).toBe(false);
      expect(result.history.configureReceipt).toBeNull();
      await expect(actor.invoke()).rejects.toThrow();
    });
    expect(h.calls.slice(before).map((c) => c.method)).toEqual(
      Array(11).fill("GET"),
    );
    expect(invoiceControls.count).toBe(6);
  },
  {
    identity: observerIdentity,
    hostQuery: authorizeObservation,
    hostInvoiceQuery: authorizeInvoices,
  },
);

configureAdmissionCase(
  "foreign customer in an expanded pinned pointer refuses before invoice I/O",
  prepareInvoiceObservation,
  async (h, state) => {
    state.reads.subscription.latest_invoice = {
      id: "in_current",
      object: "invoice",
      customer: "cus_foreign",
    };
    const before = h.calls.length;
    await h.inAnotherAction(async (ctx) => {
      const actor = await actors.captureFreshInvoiceRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await actor.invoke();
      expect(result.invoiceInventory).toBe("conflict");
      expect(result.invoiceContext).toBeNull();
    });
    expect(h.calls.slice(before)).toHaveLength(6);
    expect(invoiceControls.count).toBe(0);
  },
  options,
);

configureAdmissionCase(
  "the maintained generated API proxy is a usable fixed invoice authorization reference",
  prepareInvoiceObservation,
  async (h, state) => {
    admissionControls.invoices.splice(
      0,
      1,
      Object.freeze({
        ...state.invoiceProfile,
        authorizationQuery: anyApi.initialOwner.authorizeInvoices,
      }),
    );
    await h.inAnotherAction(async (ctx) => {
      const actor = await actors.captureFreshInvoiceRenewalObservation(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      expect((await actor.invoke()).invoiceInventory).toBe("complete");
    });
  },
  options,
);
