import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { Id } from "../../../../../component/_generated/dataModel.js";
import type { Component } from "../../../../helpers.js";
import { RenewalContextClient } from "../../../../renewalContextClient.js";

export type ClassActionInput = Readonly<{
  actualActionCtx: GenericActionCtx<GenericDataModel>;
  operationId: Id<"renewalOperations">;
}>;
type Bootstrap = Readonly<{
  prototype: object;
  select: () => unknown;
  enter: (input: ClassActionInput) => unknown;
}>;
type RootCell =
  | Readonly<{ phase: "awaiting"; component: Component }>
  | Readonly<{ phase: "ready"; component: Component; bootstrap: Bootstrap }>
  | Readonly<{ phase: "failed" }>;
const roots = new WeakMap<object, RootCell>();
const pending = new WeakMap<object, Bootstrap>();
const finishing = new WeakSet<object>();
const bootstrapSymbol = Symbol("betterstripe-class-root-bootstrap");
export const CLASS_ROOT_CONSTRUCTION_PERMIT = Symbol(
  "betterstripe-root-permit",
);
function rootUnbound(): never {
  throw Error("CLASS_ACTION_ROOT_UNBOUND");
}

/** Internal neutral base; construction alone grants no operational authority. */
export abstract class ClassOwnedActionRoot extends RenewalContextClient {
  protected constructor(
    component: Component,
    permit: typeof CLASS_ROOT_CONSTRUCTION_PERMIT,
  ) {
    if (permit !== CLASS_ROOT_CONSTRUCTION_PERMIT) rootUnbound();
    super(component);
    roots.set(this, Object.freeze({ phase: "awaiting", component }));
  }

  protected finishMaintainedRootConstruction(): void {
    const cell = roots.get(this);
    const bootstrap = pending.get(this);
    const descriptor = Object.getOwnPropertyDescriptor(this, bootstrapSymbol);
    if (
      !cell ||
      cell.phase !== "awaiting" ||
      !finishing.has(this) ||
      !bootstrap ||
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.value !== bootstrap ||
      descriptor.enumerable ||
      descriptor.writable ||
      !descriptor.configurable
    )
      rootUnbound();
    roots.set(
      this,
      Object.freeze({ phase: "ready", component: cell.component, bootstrap }),
    );
  }
}
const finalizerCandidate: unknown = Object.getOwnPropertyDescriptor(
  ClassOwnedActionRoot.prototype,
  "finishMaintainedRootConstruction",
)?.value;
if (typeof finalizerCandidate !== "function") rootUnbound();
const actualFinalizer = finalizerCandidate;

/**
 * Called by the maintained constructor under trusted package-internal imports.
 * Hostile code importing the private base and permit is outside this gate.
 */
export function finishClassRoot(actualRoot: object, raw: Bootstrap): void {
  const cell = roots.get(actualRoot);
  if (!cell || cell.phase !== "awaiting") rootUnbound();
  try {
    const keys = Reflect.ownKeys(raw);
    const prototype = Object.getOwnPropertyDescriptor(raw, "prototype");
    const select = Object.getOwnPropertyDescriptor(raw, "select");
    const enter = Object.getOwnPropertyDescriptor(raw, "enter");
    if (
      keys.length !== 3 ||
      !keys.every(
        (key) =>
          typeof key === "string" &&
          ["prototype", "select", "enter"].includes(key),
      ) ||
      !prototype ||
      !("value" in prototype) ||
      !prototype.enumerable ||
      prototype.value === null ||
      typeof prototype.value !== "object" ||
      !select ||
      !("value" in select) ||
      !select.enumerable ||
      typeof select.value !== "function" ||
      !enter ||
      !("value" in enter) ||
      !enter.enumerable ||
      typeof enter.value !== "function" ||
      roots.get(actualRoot) !== cell
    )
      rootUnbound();
    // Values are captured before the temporary descriptor exists; none is called.
    const bootstrap: Bootstrap = Object.freeze({
      prototype: prototype.value,
      select: select.value,
      enter: enter.value,
    });
    pending.set(actualRoot, bootstrap);
    Object.defineProperty(actualRoot, bootstrapSymbol, {
      value: bootstrap,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    finishing.add(actualRoot);
    Reflect.apply(actualFinalizer, actualRoot, []);
  } catch {
    roots.set(actualRoot, Object.freeze({ phase: "failed" }));
    rootUnbound();
  } finally {
    finishing.delete(actualRoot);
    pending.delete(actualRoot);
    if (!Reflect.deleteProperty(actualRoot, bootstrapSymbol)) {
      roots.set(actualRoot, Object.freeze({ phase: "failed" }));
      rootUnbound();
    }
  }
}

/** EMPTY profiles refuse before entry, client selection or Action reflection. */
export async function captureMaintainedActionSelection(
  actualRoot: object,
  _input: ClassActionInput,
): Promise<never> {
  const cell = roots.get(actualRoot);
  if (
    !cell ||
    cell.phase !== "ready" ||
    Object.getPrototypeOf(actualRoot) !== cell.bootstrap.prototype
  )
    rootUnbound();
  throw Error("CLASS_ACTION_PROFILE_UNBOUND");
}

/** Positive per-Action admission is not implemented by the inert bootstrap. */
export async function beginClassAction(
  _actualRoot: object,
  _input: ClassActionInput,
): Promise<never> {
  return rootUnbound();
}
