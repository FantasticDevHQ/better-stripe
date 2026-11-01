import { expect, it } from "vitest";
import {
  authorizationFixture,
  retain,
  retainArgs,
  read,
  readArgs,
  subject,
  witnessScope,
} from "../../test-fixtures/renewalAuthorization";

it("does not infer witness permissions from an operation observation grant", async () => {
  const h = await authorizationFixture();
  await h.t.run((ctx) => ctx.db.insert("renewalOperationGrants", h.operation));
  expect(await h.authenticated.query(retain, retainArgs)).toBeNull();
  expect(await h.authenticated.query(read, readArgs)).toBeNull();
});

it("authorizes exact retention independently of later read permission", async () => {
  const h = await authorizationFixture();
  await h.t.run((ctx) => ctx.db.insert("renewalWitnessGrants", h.witness));
  expect(await h.authenticated.query(retain, retainArgs)).toEqual({
    ...retainArgs,
    tokenIdentifier: subject.tokenIdentifier,
    authorizationId: h.metadata.authorizationId,
    authorizationRevision: h.metadata.authorizationRevision,
    expiresAtMs: h.metadata.expiresAtMs,
  });
  expect(await h.authenticated.query(read, readArgs)).toBeNull();
});

it("binds a distinct read grant to the exact immutable row, digest and full scope", async () => {
  const h = await authorizationFixture();
  const permission = {
    ...h.metadata,
    authorizationId: "separate-exact-witness-read",
    witnessRowId: "exact-stored-witness-row",
    payloadBinding: "renewal-witness:v1:sha256:" + "a".repeat(64),
  };
  await h.t.run((ctx) =>
    ctx.db.insert("renewalWitnessGrants", {
      ...h.witness,
      retain: null,
      read: permission,
    }),
  );
  expect(await h.authenticated.query(retain, retainArgs)).toBeNull();
  const expected = {
    capability: readArgs.capability,
    scope: witnessScope,
    tokenIdentifier: subject.tokenIdentifier,
    authorizationId: permission.authorizationId,
    authorizationRevision: permission.authorizationRevision,
    expiresAtMs: permission.expiresAtMs,
    witnessRowId: permission.witnessRowId,
    payloadBinding: permission.payloadBinding,
  };
  expect(await h.authenticated.query(read, readArgs)).toEqual(expected);
  expect(await h.authenticated.query(read, readArgs)).toEqual(expected);
});

it.each([
  "componentScope",
  "parentOperationId",
  "operationId",
  "witnessId",
] as const)(
  "refuses another witness %s for both capabilities",
  async (field) => {
    const h = await authorizationFixture();
    await h.t.run((ctx) => ctx.db.insert("renewalWitnessGrants", h.witness));
    const identity = { ...readArgs.identity, [field]: "foreign" };
    expect(
      await h.authenticated.query(retain, {
        ...retainArgs,
        scope: { ...witnessScope, identity },
      }),
    ).toBeNull();
    expect(
      await h.authenticated.query(read, { ...readArgs, identity }),
    ).toBeNull();
  },
);

it.each([
  { configureRequestBinding: "another-request" },
  { observedItemId: "another-item" },
  {
    nativePeriod: {
      ...witnessScope.nativePeriod,
      end: witnessScope.nativePeriod.end + 1,
    },
  },
  {
    providerScope: { ...witnessScope.providerScope, customerId: "cus_foreign" },
  },
  { providerScope: { ...witnessScope.providerScope, livemode: true } },
])("refuses material drift in requested retention scope %#", async (change) => {
  const h = await authorizationFixture();
  await h.t.run((ctx) => ctx.db.insert("renewalWitnessGrants", h.witness));
  expect(
    await h.authenticated.query(retain, {
      ...retainArgs,
      scope: { ...witnessScope, ...change },
    }),
  ).toBeNull();
});

it.each([
  { revoked: true },
  { expiresAtMs: 0 },
  { authorizationRevision: 0 },
  { authorizationRevision: 0.5 },
])(
  "refuses invalid or revoked witness permission metadata %#",
  async (change) => {
    const h = await authorizationFixture();
    await h.t.run((ctx) =>
      ctx.db.insert("renewalWitnessGrants", {
        ...h.witness,
        retain: { ...h.metadata, ...change },
        read: {
          ...h.metadata,
          ...change,
          witnessRowId: "exact-row",
          payloadBinding: "renewal-witness:v1:sha256:" + "a".repeat(64),
        },
      }),
    );
    expect(await h.authenticated.query(retain, retainArgs)).toBeNull();
    expect(await h.authenticated.query(read, readArgs)).toBeNull();
  },
);

it("denies contradictory witness grants even when the duplicate is expired", async () => {
  const h = await authorizationFixture();
  await h.t.run(async (ctx) => {
    await ctx.db.insert("renewalWitnessGrants", h.witness);
    await ctx.db.insert("renewalWitnessGrants", {
      ...h.witness,
      retain: { ...h.metadata, expiresAtMs: 0 },
    });
  });
  expect(await h.authenticated.query(retain, retainArgs)).toBeNull();
});

it("cannot use another authenticated buyer's witness grant", async () => {
  const h = await authorizationFixture();
  const other = {
    ...subject,
    subject: "other",
    tokenIdentifier: "other-token",
  };
  await h.t.run(async (ctx) => {
    await ctx.db.insert("renewalWitnessGrants", h.witness);
    await ctx.db.insert("users", {
      name: "Other buyer",
      email: "other@example.invalid",
      role: "buyer",
      authTokenIdentifier: other.tokenIdentifier,
    });
  });
  const reader = h.t.withIdentity(other);
  expect(await reader.query(retain, retainArgs)).toBeNull();
  expect(await reader.query(read, readArgs)).toBeNull();
});
