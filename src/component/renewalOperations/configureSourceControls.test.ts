import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalConfigure,
  configureComponentFixture,
} from "./configureJournal.fixtures.js";

afterEach(() => vi.unstubAllGlobals());
it.each([
  "request-payload",
  "C3-body",
  "C6-input",
  "credential-value",
  "credential-name",
  "credential-key",
])(
  "refuses contradictory or private configure %s source without inserting DATA",
  async (scenario) => {
    const h = await configureComponentFixture();
    const raw = JSON.parse(h.createArgs.recordJSON);
    const source = raw.configureRecord;
    if (scenario === "request-payload") source.request.payload.future = true;
    if (scenario === "C3-body")
      source.attachReceipt.providerSnapshot.future = true;
    if (scenario === "C6-input")
      source.configuration.configureKey += ":changed";
    if (scenario === "credential-value")
      source.configuration.freshSubscription.future =
        "Bearer synthetic-journal-token";
    if (scenario === "credential-name")
      source.configuration.freshSubscription.access_token =
        "synthetic-journal-token";
    if (scenario === "credential-key") {
      const { projectRenewalConfigurationV2 } =
        await import("../../client/billing/renewalV2/index.js");
      source.configuration.configureKey = "sk_test_SYNTHETIC_PRIVACY_CONTROL";
      const request = await projectRenewalConfigurationV2(source.configuration);
      if (!("requestIdentity" in request))
        throw Error("INVALID_FIXTURE_REQUEST");
      source.request = request;
      raw.requestBinding = request.requestIdentity.binding;
      raw.dispatch = {
        scope: request.scope,
        apiVersion: request.apiVersion,
        method: request.method,
        path: request.path,
        payload: request.payload,
        key: request.key,
        firstDispatchedAt: request.firstDispatchedAt,
      };
    }
    const before = await h.t.run((ctx) =>
      ctx.db.query("renewalOperations").take(3),
    );
    await expect(
      h.t.mutation(h.create, {
        ...h.createArgs,
        recordJSON: canonicalConfigure(raw),
      }),
    ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
    expect(
      await h.t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
    ).toEqual(before);
    expect(h.fetches()).toBe(0);
  },
);
