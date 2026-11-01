import { expect, it } from "vitest";
import {
  authorizationFixture,
  observe,
  operationArgs,
  providerScope,
  subject,
  invoiceArgs,
  invoices,
} from "../../test-fixtures/renewalAuthorization";
import { captureReaderAuthorization } from "../../../src/client/billing/renewalAttach/internal/observation/readerAuthorization.js";

it("requires actual authentication even when a demo persona exists", async () => {
  const h = await authorizationFixture();
  await expect(h.t.query(observe, operationArgs)).rejects.toThrow(
    "Authentication required",
  );
});

it.each(["componentScope", "parentOperationId", "operationId"] as const)(
  "denies a foreign %s rather than broadening a stored operation grant",
  async (field) => {
    const h = await authorizationFixture();
    await h.t.run((ctx) =>
      ctx.db.insert("renewalOperationGrants", h.operation),
    );
    expect(
      await h.authenticated.query(observe, {
        ...operationArgs,
        [field]: "foreign",
      }),
    ).toBeNull();
  },
);

it.each([
  { authorizationRevision: 0 },
  { authorizationRevision: -1 },
  { authorizationRevision: 1.5 },
  { authorizationRevision: Number.MAX_SAFE_INTEGER + 1 },
  { expiresAtMs: 0 },
  { expiresAtMs: Number.MAX_SAFE_INTEGER + 1 },
  { authorizationId: "" },
  { revoked: true },
])(
  "denies invalid, expired or revoked permission metadata %#",
  async (change) => {
    const h = await authorizationFixture();
    await h.t.run((ctx) =>
      ctx.db.insert("renewalOperationGrants", {
        ...h.operation,
        observation: { ...h.metadata, ...change },
      }),
    );
    expect(await h.authenticated.query(observe, operationArgs)).toBeNull();
  },
);

it("counts a revoked duplicate before considering the valid grant", async () => {
  const h = await authorizationFixture();
  await h.t.run(async (ctx) => {
    await ctx.db.insert("renewalOperationGrants", h.operation);
    await ctx.db.insert("renewalOperationGrants", {
      ...h.operation,
      observation: { ...h.metadata, revoked: true },
    });
  });
  expect(await h.authenticated.query(observe, operationArgs)).toBeNull();
});

it("rejects ambiguous authenticated user mappings", async () => {
  const h = await authorizationFixture();
  await h.t.run((ctx) =>
    ctx.db.insert("users", {
      authTokenIdentifier: subject.tokenIdentifier,
      name: "Contradictory mapping",
      email: "duplicate@example.invalid",
      role: "buyer",
    }),
  );
  await expect(h.authenticated.query(observe, operationArgs)).rejects.toThrow(
    "Authentication required",
  );
});

it("does not transfer a grant when the user row is remapped to another subject", async () => {
  const h = await authorizationFixture();
  const replacement = { ...subject, tokenIdentifier: "replacement-subject" };
  await h.t.run(async (ctx) => {
    await ctx.db.insert("renewalOperationGrants", h.operation);
    await ctx.db.patch("users", h.userId, {
      authTokenIdentifier: replacement.tokenIdentifier,
    });
  });
  expect(
    await h.t.withIdentity(replacement).query(observe, operationArgs),
  ).toBeNull();
});

it("requires an independent invoice grant and returns the SDK's exact invoice snapshot", async () => {
  const h = await authorizationFixture();
  const id = await h.t.run((ctx) =>
    ctx.db.insert("renewalOperationGrants", h.operation),
  );
  expect(await h.authenticated.query(invoices, invoiceArgs)).toBeNull();
  const metadata = {
    ...h.metadata,
    authorizationId: "independent-invoice-grant",
  };
  await h.t.run((ctx) =>
    ctx.db.patch("renewalOperationGrants", id, {
      observation: null,
      invoice: {
        ...metadata,
        originalInvoiceId: invoiceArgs.originalInvoiceId,
        currentInvoiceId: invoiceArgs.currentInvoiceId,
      },
    }),
  );
  expect(await h.authenticated.query(observe, operationArgs)).toBeNull();
  expect(await h.authenticated.query(invoices, invoiceArgs)).toEqual({
    ...invoiceArgs,
    tokenIdentifier: subject.tokenIdentifier,
    authorizationId: metadata.authorizationId,
    authorizationRevision: metadata.authorizationRevision,
    expiresAtMs: metadata.expiresAtMs,
  });
});

it.each([
  "customerAccountId",
  "customerId",
  "subscriptionId",
  "scheduleId",
] as const)("denies invoices for a foreign %s", async (field) => {
  const h = await authorizationFixture();
  await h.t.run((ctx) =>
    ctx.db.insert("renewalOperationGrants", {
      ...h.operation,
      invoice: {
        ...h.metadata,
        originalInvoiceId: invoiceArgs.originalInvoiceId,
        currentInvoiceId: invoiceArgs.currentInvoiceId,
      },
    }),
  );
  expect(
    await h.authenticated.query(invoices, {
      ...invoiceArgs,
      providerScope: { ...providerScope, [field]: "foreign" },
    }),
  ).toBeNull();
});

it.each(["originalInvoiceId", "currentInvoiceId"] as const)(
  "denies another %s even when every other operation field matches",
  async (field) => {
    const h = await authorizationFixture();
    await h.t.run((ctx) =>
      ctx.db.insert("renewalOperationGrants", {
        ...h.operation,
        invoice: {
          ...h.metadata,
          originalInvoiceId: invoiceArgs.originalInvoiceId,
          currentInvoiceId: invoiceArgs.currentInvoiceId,
        },
      }),
    );
    expect(
      await h.authenticated.query(invoices, {
        ...invoiceArgs,
        [field]: "foreign",
      }),
    ).toBeNull();
  },
);

it.each(["admin", "seller", "visitor", "affiliate"] as const)(
  "does not promote an authenticated %s persona into buyer observation authority",
  async (role) => {
    const h = await authorizationFixture();
    await h.t.run(async (ctx) => {
      await ctx.db.insert("renewalOperationGrants", h.operation);
      await ctx.db.patch("users", h.userId, { role });
    });
    await expect(h.authenticated.query(observe, operationArgs)).rejects.toThrow(
      "Authentication required",
    );
  },
);

it("rejects caller-supplied user identity fields at the registered query boundary", async () => {
  const h = await authorizationFixture();
  const suppliedIdentity = { ...operationArgs, userId: h.userId };
  await expect(
    h.authenticated.query(observe, suppliedIdentity),
  ).rejects.toThrow("Validator error");
});

it("returns no permission for an authenticated buyer without an exact operation grant", async () => {
  const h = await authorizationFixture();
  expect(await h.authenticated.query(observe, operationArgs)).toBeNull();
});

it("returns a stable exact grant accepted by the SDK authorization contract", async () => {
  const h = await authorizationFixture();
  await h.t.run((ctx) => ctx.db.insert("renewalOperationGrants", h.operation));
  const expected = {
    ...operationArgs,
    tokenIdentifier: subject.tokenIdentifier,
    providerScope: {
      mode: providerScope.mode,
      stripeAccount: providerScope.stripeAccount,
      livemode: providerScope.livemode,
      customerAccountId: providerScope.customerAccountId,
      subscriptionId: providerScope.subscriptionId,
      scheduleId: providerScope.scheduleId,
    },
    authorizationId: h.metadata.authorizationId,
    authorizationRevision: h.metadata.authorizationRevision,
    expiresAtMs: h.metadata.expiresAtMs,
  };
  const first = await h.authenticated.query(observe, operationArgs);
  expect(first).toEqual(expected);
  expect(
    captureReaderAuthorization(
      first,
      operationArgs,
      subject.tokenIdentifier,
      Date.now(),
    ),
  ).toEqual(expected);
  expect(await h.authenticated.query(observe, operationArgs)).toEqual(first);
});
