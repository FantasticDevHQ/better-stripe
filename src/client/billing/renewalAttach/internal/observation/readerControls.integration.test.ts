import { expect, vi } from "vitest";
import {
  configureAdmissionCase,
  admissionControls,
} from "../test-fixtures/producerConfigureAdmission.js";
import {
  prepareObservationReader,
  observerIdentity,
  authorizeObservation,
  readerControls,
} from "../test-fixtures/observationReader.js";
import { captureAuthorizedObservationHistoryReader } from "./reader.js";
import { BetterStripe } from "../../../../index.js";
import { getFunctionAddress } from "convex/server";
function mutable(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw Error("FIXTURE_DATA");
  return value as Record<string, unknown>;
}
configureAdmissionCase(
  "manifest mutation after an event reply cannot extend the fixed event-query bound",
  prepareObservationReader,
  async (h, state) => {
    await h.inAnotherAction(async (ctx) => {
      const query = ctx.runQuery;
      let manifest: unknown[] | null = null,
        eventQueries = 0;
      ctx.runQuery = async (ref, ...args) => {
        const result = await query(ref, ...args);
        const address = JSON.stringify(getFunctionAddress(ref));
        if (
          address.includes("readAttempt") &&
          mutable(args[0]).operationId === state.operationId
        )
          manifest = mutable(result).events as unknown[];
        if (
          address.includes("readStageEvent") &&
          mutable(args[0]).operationId === state.operationId
        ) {
          eventQueries++;
          if (eventQueries === 1 && manifest)
            manifest.push(structuredClone(manifest[2]));
        }
        return result;
      };
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const result = await reader.read().catch(() => null);
      expect(eventQueries).toBe(3);
      expect(result?.history.configureHead).toBe(3);
    });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "Proxy event manifests reject before length or key traps and before event queries",
  prepareObservationReader,
  async (h, state) => {
    await h.inAnotherAction(async (ctx) => {
      const query = ctx.runQuery;
      let traps = 0,
        events = 0;
      ctx.runQuery = async (ref, ...args) => {
        const result = await query(ref, ...args);
        const address = JSON.stringify(getFunctionAddress(ref));
        if (
          address.includes("readAttempt") &&
          mutable(args[0]).operationId === state.parentOperationId
        ) {
          const array = mutable(result).events;
          mutable(result).events = new Proxy(array as unknown[], {
            get() {
              traps++;
              throw Error("TRAP");
            },
            ownKeys() {
              traps++;
              throw Error("TRAP");
            },
          });
        }
        if (address.includes("readStageEvent")) events++;
        return result;
      };
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      await expect(reader.read()).rejects.toThrow();
      expect(traps).toBe(0);
      expect(events).toBe(0);
    });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "auth, RPC, root and host address drift during authorization closes before DATA reads",
  prepareObservationReader,
  async (h, state) => {
    for (const mode of ["auth", "rpc", "root", "address"] as const)
      await h.inAnotherAction(async (ctx) => {
        const query = ctx.runQuery,
          identity = ctx.auth.getUserIdentity,
          proto = Object.getPrototypeOf(h.sdk);
        let calls = 0;
        ctx.runQuery = async (ref, ...args) => {
          const value = await query(ref, ...args);
          if (++calls === 1) {
            if (mode === "auth") ctx.auth.getUserIdentity = async () => null;
            if (mode === "rpc") ctx.runQuery = async () => null;
            if (mode === "root") Object.setPrototypeOf(h.sdk, {});
            if (mode === "address")
              Reflect.set(
                state.entry.authorizationQuery,
                Symbol.for("functionName"),
                "initialOwner:foreign",
              );
          }
          return value;
        };
        try {
          const reader = await captureAuthorizedObservationHistoryReader(
            h.sdk,
            {
              actualActionCtx: ctx,
              operationId: state.operationId,
              parentOperationId: state.parentOperationId,
            },
          );
          await expect(reader.read()).rejects.toThrow();
          expect(calls).toBe(1);
        } finally {
          ctx.runQuery = query;
          ctx.auth.getUserIdentity = identity;
          Object.setPrototypeOf(h.sdk, proto);
          Reflect.set(
            state.entry.authorizationQuery,
            Symbol.for("functionName"),
            "initialOwner:authorize",
          );
        }
      });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "all four component query address substitutions refuse before authorization",
  prepareObservationReader,
  async (h, state) => {
    const actual = state.entry.component,
      q = actual.renewalOperations.queries;
    const queries = {
      loadAuthorizedOperation: q.loadAuthorizedOperation,
      readAttempt: q.readAttempt,
      readStageEvent: q.readStageEvent,
      readProviderAcknowledgement: q.readProviderAcknowledgement,
    };
    const operations = new Proxy(actual.renewalOperations, {
      get(target, key) {
        return key === "queries" ? queries : Reflect.get(target, key);
      },
    });
    const component = new Proxy(actual, {
      get(target, key) {
        return key === "renewalOperations"
          ? operations
          : Reflect.get(target, key);
      },
    });
    const root = new BetterStripe(component, {
      STRIPE_SECRET_KEY: "sk_test_invalid_read_only",
    });
    admissionControls.history.splice(
      0,
      1,
      Object.freeze({ ...state.entry, component }),
    );
    for (const key of Object.keys(queries))
      await h.inAnotherAction(async (ctx) => {
        const reader = await captureAuthorizedObservationHistoryReader(root, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        const original = Reflect.get(queries, key);
        Reflect.set(
          queries,
          key,
          key === "readAttempt" ? queries.readStageEvent : queries.readAttempt,
        );
        try {
          await expect(reader.read()).rejects.toThrow();
        } finally {
          Reflect.set(queries, key, original);
        }
      });
    expect(readerControls.authorizations).toBe(0);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "authorization expiry after the first component query stops all later reads",
  prepareObservationReader,
  async (h, state) => {
    readerControls.grant.expiresAtMs = Date.now() + 1000;
    await h.inAnotherAction(async (ctx) => {
      const query = ctx.runQuery;
      let queries = 0;
      ctx.runQuery = async (ref, ...args) => {
        const result = await query(ref, ...args);
        if (++queries === 2)
          vi.setSystemTime(Number(readerControls.grant.expiresAtMs));
        return result;
      };
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      await expect(reader.read()).rejects.toThrow();
      expect(queries).toBe(2);
    });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
const changes: [string, (r: Record<string, unknown>) => void][] = [
  [
    "subject",
    (r) => {
      r.tokenIdentifier = "foreign";
    },
  ],
  [
    "component",
    (r) => {
      r.componentScope = "foreign";
    },
  ],
  [
    "parent",
    (r) => {
      r.parentOperationId = "foreign";
    },
  ],
  [
    "child",
    (r) => {
      r.operationId = "foreign";
    },
  ],
  [
    "account",
    (r) => {
      mutable(r.providerScope).customerAccountId = "foreign";
    },
  ],
  [
    "subscription",
    (r) => {
      mutable(r.providerScope).subscriptionId = "sub_foreign";
    },
  ],
  [
    "schedule",
    (r) => {
      mutable(r.providerScope).scheduleId = "sub_sched_foreign";
    },
  ],
  [
    "mode",
    (r) => {
      mutable(r.providerScope).mode = "connected";
    },
  ],
  [
    "stripeAccount",
    (r) => {
      mutable(r.providerScope).stripeAccount = "acct_foreign";
    },
  ],
  [
    "livemode",
    (r) => {
      mutable(r.providerScope).livemode = true;
    },
  ],
  [
    "id",
    (r) => {
      r.authorizationId = "";
    },
  ],
  [
    "revision",
    (r) => {
      r.authorizationRevision = 0;
    },
  ],
  [
    "expired",
    (r) => {
      r.expiresAtMs = Date.now();
    },
  ],
  [
    "extra",
    (r) => {
      r.allowed = true;
    },
  ],
  [
    "stable revision changes",
    (r) => {
      r.authorizationRevision = 4;
    },
  ],
  [
    "stable expiry changes",
    (r) => {
      r.expiresAtMs = Number(r.expiresAtMs) + 1;
    },
  ],
  [
    "stable authorization id changes",
    (r) => {
      r.authorizationId = "other-valid-id";
    },
  ],
];
for (const [name, change] of changes)
  configureAdmissionCase(
    "rejects first and final authorization: " + name,
    prepareObservationReader,
    async (h, state) => {
      for (const final of [false, true]) {
        readerControls.authorizations = 0;
        readerControls.reply = (r, count) => {
          if (!final || count === 2) change(r);
          return r;
        };
        await h.inAnotherAction(async (ctx) => {
          const reader = await captureAuthorizedObservationHistoryReader(
            h.sdk,
            {
              actualActionCtx: ctx,
              operationId: state.operationId,
              parentOperationId: state.parentOperationId,
            },
          );
          let refused = false;
          try {
            await reader.read();
          } catch {
            refused = true;
          }
          const stableChange = name.startsWith("stable ");
          expect(refused, (final ? "final " : "first ") + name).toBe(
            final || !stableChange,
          );
          await expect(reader.read()).rejects.toThrow();
        });
      }
    },
    { identity: observerIdentity, hostQuery: authorizeObservation },
  );
configureAdmissionCase(
  "idle deadline, clock rollback and exact wall/ns equality permanently close the reader",
  prepareObservationReader,
  async (h, state) => {
    const wall = Date.now(),
      ns = process.hrtime.bigint();
    for (const mode of [
      "idle",
      "wall-end",
      "ns-end",
      "wall-back",
      "ns-back",
    ] as const) {
      vi.setSystemTime(wall);
      vi.mocked(process.hrtime.bigint).mockReturnValue(ns);
      await h.inAnotherAction(async (ctx) => {
        const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        if (mode === "idle") await vi.advanceTimersByTimeAsync(30000);
        if (mode === "wall-end") vi.setSystemTime(wall + 30000);
        if (mode === "wall-back") vi.setSystemTime(wall - 1);
        if (mode === "ns-end")
          vi.mocked(process.hrtime.bigint).mockReturnValue(ns + 30000000000n);
        if (mode === "ns-back")
          vi.mocked(process.hrtime.bigint).mockReturnValue(ns - 1n);
        await expect(reader.read()).rejects.toThrow(
          "OBSERVATION_HISTORY_READER_EXPIRED",
        );
        await expect(reader.read()).rejects.toThrow();
      });
    }
    vi.setSystemTime(wall);
    vi.mocked(process.hrtime.bigint).mockReturnValue(ns);
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "fixed authorization address mutation is detected before any query",
  prepareObservationReader,
  async (h, state) => {
    await h.inAnotherAction(async (ctx) => {
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const key = Symbol.for("functionName");
      Reflect.set(state.entry.authorizationQuery, key, "initialOwner:foreign");
      try {
        await expect(reader.read()).rejects.toThrow();
      } finally {
        Reflect.set(
          state.entry.authorizationQuery,
          key,
          "initialOwner:authorize",
        );
      }
      expect(readerControls.authorizations).toBe(0);
    });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "null identity and host denial refuse before component reads",
  prepareObservationReader,
  async (h, state) => {
    for (const denied of [false, true])
      await h.inAnotherAction(async (ctx) => {
        const originalIdentity = ctx.auth.getUserIdentity;
        if (!denied) ctx.auth.getUserIdentity = async () => null;
        readerControls.deny = denied;
        const queries = vi.spyOn(ctx, "runQuery");
        const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        await expect(reader.read()).rejects.toThrow();
        expect(queries).toHaveBeenCalledTimes(denied ? 1 : 0);
        ctx.auth.getUserIdentity = originalIdentity;
        queries.mockRestore();
      });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "hung metadata and hung authorization expire once and ignore late replies",
  prepareObservationReader,
  async (h, state) => {
    await h.inAnotherAction(async (ctx) => {
      const metadata = ctx.meta.getFunctionMetadata;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      ctx.meta.getFunctionMetadata = async () => {
        await held;
        return metadata();
      };
      const pending = captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const rejected = expect(pending).rejects.toThrow(
        "OBSERVATION_HISTORY_READER_EXPIRED",
      );
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      release();
      await Promise.resolve();
    });
    await h.inAnotherAction(async (ctx) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      ctx.runQuery = async () => {
        await held;
        return null;
      };
      const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      });
      const pending = reader.read();
      const rejected = expect(pending).rejects.toThrow(
        "OBSERVATION_HISTORY_READER_EXPIRED",
      );
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      release();
      await expect(reader.read()).rejects.toThrow();
    });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
configureAdmissionCase(
  "refuses ambiguous/wrong component entries and captured pointer drift",
  prepareObservationReader,
  async (h, state) => {
    admissionControls.history.push(state.entry);
    await expect(
      captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: h.ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      }),
    ).rejects.toThrow();
    admissionControls.history.splice(0, admissionControls.history.length, {
      ...state.entry,
      component: {},
    });
    await expect(
      captureAuthorizedObservationHistoryReader(h.sdk, {
        actualActionCtx: h.ctx,
        operationId: state.operationId,
        parentOperationId: state.parentOperationId,
      }),
    ).rejects.toThrow();
    admissionControls.history.splice(0, 1, state.entry);
    for (const mode of ["auth", "query", "root"] as const)
      await h.inAnotherAction(async (ctx) => {
        const reader = await captureAuthorizedObservationHistoryReader(h.sdk, {
          actualActionCtx: ctx,
          operationId: state.operationId,
          parentOperationId: state.parentOperationId,
        });
        if (mode === "auth") ctx.auth.getUserIdentity = async () => null;
        if (mode === "query") ctx.runQuery = async () => null;
        const proto = Object.getPrototypeOf(h.sdk);
        if (mode === "root") Object.setPrototypeOf(h.sdk, {});
        try {
          await expect(reader.read()).rejects.toThrow();
        } finally {
          Object.setPrototypeOf(h.sdk, proto);
        }
      });
  },
  { identity: observerIdentity, hostQuery: authorizeObservation },
);
