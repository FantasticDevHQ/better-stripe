import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { modules, schema } from "../test";
import componentSchema from "../../src/component/schema.js";

const componentModules = import.meta.glob("../../src/component/**/*.*s");
export const subject = {
  subject: "renewal-buyer",
  issuer: "https://example-qualification.invalid",
  tokenIdentifier: "https://example-qualification.invalid|renewal-buyer",
};
export const operationArgs = {
  componentScope: "example-installation",
  parentOperationId: "original-attachment",
  operationId: "original-configuration",
};
export const providerScope = {
  mode: "platform" as const,
  stripeAccount: null,
  livemode: false,
  customerAccountId: "acct_original_buyer",
  customerId: "cus_original_buyer",
  subscriptionId: "sub_original",
  scheduleId: "sub_sched_owned",
};
export const observe = makeFunctionReference<
  "query",
  typeof operationArgs,
  unknown
>("renewalAuthorization/queries:observe");
export const invoiceArgs = {
  capability: "renewal_invoice_evidence_v1" as const,
  ...operationArgs,
  providerScope,
  originalInvoiceId: "in_original",
  currentInvoiceId: "in_current",
};
export const invoices = makeFunctionReference<
  "query",
  typeof invoiceArgs,
  unknown
>("renewalAuthorization/queries:invoices");
export const witnessScope = {
  identity: { ...operationArgs, witnessId: "original-period-witness" },
  providerScope,
  configureRequestBinding: "complete-original-configuration-binding",
  observedItemId: "si_original_successor",
  nativePeriod: { start: 1771113600, end: 1771718400 },
};
export const retainArgs = {
  capability: "renewal_witness_retain_v1" as const,
  scope: witnessScope,
};
export const readArgs = {
  capability: "renewal_witness_read_v1" as const,
  identity: witnessScope.identity,
};
export const retain = makeFunctionReference<
  "query",
  typeof retainArgs,
  unknown
>("renewalAuthorization/queries:retainWitness");
export const read = makeFunctionReference<"query", typeof readArgs, unknown>(
  "renewalAuthorization/queries:readWitness",
);

/** Trusted fixture setup only; there is no client-callable grant issuer. */
export async function authorizationFixture() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      authTokenIdentifier: subject.tokenIdentifier,
      name: "Controlled authenticated buyer",
      email: "renewal-buyer@example.invalid",
      role: "buyer",
    }),
  );
  const metadata = {
    authorizationId: "example-observation-grant",
    authorizationRevision: 1,
    expiresAtMs: Date.now() + 60000,
    revoked: false,
  };
  const operation = {
    userId,
    tokenIdentifier: subject.tokenIdentifier,
    ...operationArgs,
    providerScope,
    observation: metadata,
    invoice: null,
  };
  const witness = {
    userId,
    tokenIdentifier: subject.tokenIdentifier,
    componentScope: operationArgs.componentScope,
    witnessId: witnessScope.identity.witnessId,
    scope: witnessScope,
    retain: metadata,
    read: null,
  };
  return {
    t,
    userId,
    metadata,
    operation,
    witness,
    authenticated: t.withIdentity(subject),
  };
}
