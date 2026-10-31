import { readInitialLineage } from "./lineageAuthority.js";
import { types } from "node:util";
import type { OriginalBasis, OriginalSample } from "../originalOwner.js";

export type InitialOwner = Readonly<{
  basis: Readonly<OriginalBasis>;
  check(): Readonly<OriginalSample>;
  sample(): Readonly<OriginalSample>;
  subscribe(fn: () => void): () => void;
  retire(): void;
}>;

const owners = new WeakMap<object, InitialOwner>();
function stop(): never {
  throw Error("INITIAL_OWNER_STOP");
}
/** One canonical, independently retired Owner per original private lineage. */
export function ownerForInitialLineage(token: object): InitialOwner {
  const existing = owners.get(token);
  if (existing) return existing;
  const lineage = readInitialLineage(token);
  const { basis, policy } = lineage;
  let closed = false;
  let checking = false;
  let last: Readonly<OriginalSample> | null = null;
  const listeners = new Set<{ fn: () => void; active: boolean }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function retire() {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    const active = [...listeners];
    listeners.clear();
    for (const listener of active) {
      if (!listener.active) continue;
      listener.active = false;
      try {
        Reflect.apply(listener.fn, undefined, []);
      } catch {
        /* Retirement cannot be reversed by a waiter. */
      }
    }
  }
  function check(): Readonly<OriginalSample> {
    if (closed || checking) {
      retire();
      stop();
    }
    checking = true;
    try {
      if (readInitialLineage(token) !== lineage) stop();
      const wallMs = lineage.wall();
      const ns = lineage.monotonic();
      const nowSeconds = Math.floor(wallMs / 1000);
      if (
        !Number.isSafeInteger(wallMs) ||
        wallMs < basis.startWallMs ||
        wallMs >= basis.workEndWallMs ||
        wallMs >= basis.endWallMs ||
        ns < lineage.initialHighNs ||
        ns >= basis.workEndNs ||
        ns >= basis.endNs ||
        (last && (wallMs < last.wallMs || ns < last.ns)) ||
        nowSeconds < policy.firstDispatchedAt ||
        nowSeconds - policy.firstDispatchedAt >= 86400 ||
        nowSeconds < policy.periodStart ||
        nowSeconds >= policy.periodEnd ||
        closed
      )
        stop();
      last = Object.freeze({ wallMs, ns, nowSeconds, retired: false });
      return last;
    } catch {
      retire();
      return stop();
    } finally {
      checking = false;
    }
  }
  const owner: InitialOwner = Object.freeze({
    get basis() {
      if (closed) stop();
      return basis;
    },
    check,
    sample: check,
    retire,
    subscribe(listener: () => void) {
      if (typeof listener !== "function" || types.isProxy(listener)) {
        retire();
        stop();
      }
      if (closed) {
        try {
          listener();
        } catch {
          /* Already retired. */
        }
        return () => {};
      }
      const record = { fn: listener, active: true };
      listeners.add(record);
      return () => {
        record.active = false;
        listeners.delete(record);
      };
    },
  });
  owners.set(token, owner);
  try {
    check();
    // Absolute original cutoff, never a new budget when a continuation resumes.
    timer = setTimeout(
      retire,
      Math.max(0, basis.workEndWallMs - lineage.wall()),
    );
    timer.unref?.();
    check();
    return owner;
  } catch (error) {
    retire();
    throw error;
  }
}
