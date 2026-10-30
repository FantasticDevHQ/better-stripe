import assert from "node:assert/strict";
import { vi } from "vitest";
import { types } from "node:util";
import { observationLatch } from "./observationProbe.js";
import type { ObservationDeclaration } from "./observationDeclarations.js";

/** Fresh READONLY closed fake HTTP. No old43 or preflight transport capability. */
export async function observationHTTP(
  d: ObservationDeclaration,
  owner: typeof import("../originalOwner.js").OWNER,
) {
  const hold = observationLatch();
  let delegateEntered = 0;
  let delegatePassedOwnerEntries = 0;
  let traps = 0,
    diagnosticGetterCalls = 0,
    actualError: unknown = null;
  let networkError: Error | null = null;
  let errorConfigurationVerified = 0;
  let transformedError: unknown = null;
  const decorateError = (error: unknown) => {
    assert(error instanceof Error && !types.isProxy(error));
    assert.notEqual(
      error,
      networkError,
      "actual SDK rejection, not injected delegate rejection",
    );
    actualError = error;
    assert(Object.isExtensible(error));
    for (const key of ["type", "code", "statusCode", "requestId"]) {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      assert(
        descriptor && "value" in descriptor && descriptor.configurable === true,
        "declared four-field actual SDK error transformation must be applicable",
      );
    }
    errorConfigurationVerified++;
    if (d.transport.safeDiagnostics)
      for (const [key, value] of Object.entries(d.transport.safe))
        Object.defineProperty(error, key, {
          value,
          configurable: true,
          enumerable: true,
          writable: true,
        });
    if (d.transport.emptyDiagnostics)
      for (const key of ["type", "code", "statusCode", "requestId"])
        assert.equal(Reflect.deleteProperty(error, key), true);
    if (d.transport.hostileDiagnostics) {
      Object.defineProperty(error, "code", {
        configurable: true,
        enumerable: true,
        get() {
          diagnosticGetterCalls++;
          throw Error("TEST_DIAGNOSTIC_GETTER_MUST_NOT_RUN");
        },
      });
      Object.defineProperty(error, "requestId", {
        value: d.transport.unsafeRequestId,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
    transformedError = error;
    assert.equal(
      transformedError,
      actualError,
      "four-field TEST decoration preserves actual error identity",
    );
    if (d.transport.retireAtCatch) owner.retire();
  };
  const calls: { method: string; path: string }[] = [];
  const argsSeen: unknown[][] = [];
  const originals: Promise<unknown>[] = [];
  const joined: Promise<unknown>[] = [];
  let finalReadSample: ReturnType<typeof owner.check> | null = null;
  vi.stubGlobal("fetch", async (input: unknown, init: RequestInit) => {
    const row = d.rows[calls.length];
    assert(row, "UNDECLARED_OBSERVATION_HTTP");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(url.pathname + url.search, row.path);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("stripe-version"), d.baseline.apiVersion);
    assert.equal(headers.get("stripe-account"), null);
    calls.push({ method: "GET", path: row.path });
    if (d.transport.active && calls.length === d.transport.ordinal) {
      if (d.transport.held) {
        hold.entered.resolve();
        await hold.release.promise;
      }
      if (d.transport.reject) {
        networkError = Object.assign(
          Error("DECLARED_CLOSED_OBSERVATION_HTTP_REJECTION"),
          { code: "ECONNRESET" },
        );
        throw networkError;
      }
    }
    return new Response(JSON.stringify(row.body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_SYNTHETIC_OBSERVATION",
      },
    });
  });
  const { getStripeClient } = await import("../../../../helpers.js");
  const client = getStripeClient(
    "sk_test_SYNTHETIC_OBSERVATION_NO_CREDENTIAL",
    d.baseline.apiVersion,
    { singleAttempt: true },
  );
  const method = client.rawRequest;
  const delegate = Object.freeze({
    rawRequest(...args: unknown[]) {
      delegateEntered++;
      owner.check();
      delegatePassedOwnerEntries++;
      const row = d.rows[argsSeen.length];
      assert(row);
      assert.deepEqual(args, ["GET", row.path, undefined, row.options]);
      argsSeen.push(args);
      const promise = Reflect.apply(method, client, args) as Promise<unknown>;
      originals.push(promise);
      joined.push(
        promise.then(
          (value) => {
            if (d.transport.held && argsSeen.length === d.transport.ordinal) {
              assert(
                value !== null &&
                  typeof value === "object" &&
                  Object.isExtensible(value),
              );
              const sentinel = new Proxy(
                { declared: true },
                {
                  get(target, key, receiver) {
                    traps++;
                    return Reflect.get(target, key, receiver);
                  },
                  ownKeys(target) {
                    traps++;
                    return Reflect.ownKeys(target);
                  },
                  getPrototypeOf(target) {
                    traps++;
                    return Reflect.getPrototypeOf(target);
                  },
                  getOwnPropertyDescriptor(target, key) {
                    traps++;
                    return Reflect.getOwnPropertyDescriptor(target, key);
                  },
                },
              );
              Object.defineProperty(value, "ownedLateSentinel", {
                value: sentinel,
                enumerable: true,
                configurable: true,
              });
            }
            if (d.expectedOwner === "live") {
              const sample = owner.check();
              if (argsSeen.length === d.rows.length) finalReadSample = sample;
            }
          },
          (error: unknown) => {
            if (d.transport.active) decorateError(error);
          },
        ),
      );
      return promise;
    },
  });
  return {
    calls,
    hold,
    delegateEntries: () => delegateEntered,
    traps: () => traps,
    diagnosticGetterCalls: () => diagnosticGetterCalls,
    actualError: () => actualError,
    transformedError: () => transformedError,
    errorConfigurationVerified: () => errorConfigurationVerified,
    argsSeen,
    originals,
    delegate,
    finalSample: () => finalReadSample,
    delegateEntriesAfterOwner: () => delegatePassedOwnerEntries,
    async cleanup() {
      await Promise.all(joined);
    },
  };
}
