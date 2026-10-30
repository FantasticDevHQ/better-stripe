import "./test-fixtures/semanticSetup.js";
import { it as test } from "vitest";
import assert from "node:assert/strict";
const { fixture, copy } = await import("./test-fixtures/fixture.mjs");
const { createAttachEventCompiler } =
  await import("./test-fixtures/compilerIndex.mjs");
for (const kind of [
  "secret-object",
  "secret-array",
  "secret-text",
  "whole-bytes",
])
  test(
    "reflection between ordinary admission and detach rejects " +
      kind +
      " before materialize/hash",
    async () => {
      const f = await fixture(),
        raw = copy(f.sourceAttach);
      let prototypes = 0,
        clones = 0,
        hashes = 0;
      const property =
        kind.startsWith("secret-") && kind !== "secret-text"
          ? "client_secret"
          : "unclassified";
      const value =
        kind === "secret-object"
          ? {}
          : kind === "secret-array"
            ? []
            : kind === "secret-text"
              ? "sk_test_SYNTHETIC"
              : Array.from({ length: 20 }, () => "x".repeat(30000));
      raw.preparation.subscription = new Proxy(raw.preparation.subscription, {
        getPrototypeOf(t) {
          prototypes++;
          if (prototypes === 2)
            Object.defineProperty(t, property, {
              value,
              enumerable: true,
              configurable: true,
            });
          return Object.prototype;
        },
      });
      const originalEntries = Object.fromEntries,
        originalDigest = globalThis.crypto.subtle.digest;
      Object.fromEntries = function (
        entries: Iterable<readonly [PropertyKey, unknown]>,
      ) {
        const rows = Array.from(entries);
        if (
          rows.some(
            ([k, v]) =>
              k === property &&
              v !== null &&
              (typeof v === "object" || typeof v === "string"),
          )
        )
          clones++;
        return originalEntries(rows);
      };
      globalThis.crypto.subtle.digest = function (...a) {
        hashes++;
        return originalDigest.apply(this, a);
      };
      try {
        assert.throws(
          () =>
            createAttachEventCompiler(raw, {
              timeoutMs: 5000,
              send: async () => {
                throw Error("NO_SEND");
              },
            }),
          /C10_SOURCE_STOP/,
        );
        assert.ok(prototypes >= 2);
        assert.equal(clones, 0);
        assert.equal(hashes, 0);
      } finally {
        Object.fromEntries = originalEntries;
        globalThis.crypto.subtle.digest = originalDigest;
      }
    },
  );
