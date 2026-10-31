import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { Component } from "../../../../helpers.js";
import { RenewalContextClient } from "../../../../renewalContextClient.js";

export type ClassActionInput = Readonly<{
  actualActionCtx: GenericActionCtx<GenericDataModel>;
  operationId: string;
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

/** Operational EMPTY profiles refuse before entry, selector or Action reflection. */
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

type ReadyRoot = Extract<RootCell, { phase: "ready" }>;
type ActionContext = ClassActionInput["actualActionCtx"];
type JournalRPC = Readonly<{
  receiver: ActionContext;
  component: Component;
  operationId: string;
  metaReceiver: ActionContext["meta"];
  getMetadata: ActionContext["meta"]["getFunctionMetadata"];
  runQuery: ActionContext["runQuery"];
  runMutation: ActionContext["runMutation"];
  tag: object;
}>;
type PendingJournal = {
  root: object;
  cell: ReadyRoot;
  input: ClassActionInput;
  entered: boolean;
  binding: object | null;
};
type JournalState = Readonly<{
  root: object;
  cell: ReadyRoot;
  rpc: JournalRPC;
}>;
const pendingJournalEntries = new WeakMap<object, PendingJournal>();
const journalBindings = new WeakMap<object, JournalState>();
const closedJournalBindings = new WeakSet<object>();
function journalUnbound(): never {
  throw Error("CLASS_ACTION_JOURNAL_UNBOUND");
}
function journalPointersMatch(state: JournalState): boolean {
  const { root, cell, rpc } = state;
  return (
    roots.get(root) === cell &&
    Object.getPrototypeOf(root) === cell.bootstrap.prototype &&
    rpc.receiver.meta === rpc.metaReceiver &&
    rpc.metaReceiver.getFunctionMetadata === rpc.getMetadata &&
    rpc.receiver.runQuery === rpc.runQuery &&
    rpc.receiver.runMutation === rpc.runMutation
  );
}

/** Checked private bookkeeping identity only; never an operational selection. */
export function readCheckedJournalActionRPC(binding: unknown): JournalRPC {
  if (typeof binding !== "object" || binding === null) journalUnbound();
  const state = journalBindings.get(binding);
  if (!state || closedJournalBindings.has(binding)) journalUnbound();
  try {
    if (!journalPointersMatch(state)) journalUnbound();
  } catch {
    closedJournalBindings.add(binding);
    journalUnbound();
  }
  return state.rpc;
}

/** Fixed class entry for journal DATA, independent of operational qualification. */
export async function captureMaintainedJournalBinding(
  actualRoot: object,
  input: ClassActionInput,
): Promise<object> {
  const cell = roots.get(actualRoot);
  if (
    !cell ||
    cell.phase !== "ready" ||
    Object.getPrototypeOf(actualRoot) !== cell.bootstrap.prototype
  )
    rootUnbound();
  const keys = Reflect.ownKeys(input);
  const context = Object.getOwnPropertyDescriptor(input, "actualActionCtx");
  const operation = Object.getOwnPropertyDescriptor(input, "operationId");
  if (
    keys.length !== 2 ||
    !keys.every((key) => key === "actualActionCtx" || key === "operationId") ||
    !context ||
    !("value" in context) ||
    !context.enumerable ||
    !operation ||
    !("value" in operation) ||
    !operation.enumerable ||
    typeof operation.value !== "string" ||
    operation.value.length === 0
  )
    journalUnbound();
  const entryInput: ClassActionInput = Object.freeze({
    actualActionCtx: context.value,
    operationId: operation.value,
  });
  const entry: PendingJournal = {
    root: actualRoot,
    cell,
    input: entryInput,
    entered: false,
    binding: null,
  };
  pendingJournalEntries.set(entryInput, entry);
  try {
    const result: unknown = await Reflect.apply(
      cell.bootstrap.enter,
      actualRoot,
      [entryInput],
    );
    if (
      typeof result !== "object" ||
      result === null ||
      result !== entry.binding ||
      pendingJournalEntries.get(entryInput) !== entry ||
      !entry.entered
    )
      journalUnbound();
    const state = journalBindings.get(result);
    if (
      !state ||
      state.root !== actualRoot ||
      state.cell !== cell ||
      state.rpc.operationId !== entryInput.operationId
    )
      journalUnbound();
    readCheckedJournalActionRPC(result);
    return result;
  } catch (error) {
    if (entry.binding) closedJournalBindings.add(entry.binding);
    throw error;
  } finally {
    pendingJournalEntries.delete(entryInput);
  }
}

/** Only the actual constructor-captured private entry can complete pending DATA. */
export async function beginClassAction(
  actualRoot: object,
  input: ClassActionInput,
): Promise<object> {
  const entry = pendingJournalEntries.get(input);
  if (
    !entry ||
    entry.root !== actualRoot ||
    entry.input !== input ||
    entry.entered ||
    roots.get(actualRoot) !== entry.cell
  )
    return rootUnbound();
  entry.entered = true;
  const receiver = input.actualActionCtx;
  if (typeof receiver !== "object" || receiver === null) journalUnbound();
  const metaReceiver = receiver.meta;
  const getMetadata = metaReceiver?.getFunctionMetadata;
  const runQuery = receiver.runQuery;
  const runMutation = receiver.runMutation;
  if (
    typeof getMetadata !== "function" ||
    typeof runQuery !== "function" ||
    typeof runMutation !== "function"
  )
    journalUnbound();
  const rpc: JournalRPC = Object.freeze({
    receiver,
    component: entry.cell.component,
    operationId: input.operationId,
    metaReceiver,
    getMetadata,
    runQuery,
    runMutation,
    tag: Object.freeze({}),
  });
  const metadata = await getMetadata.call(metaReceiver);
  const state: JournalState = Object.freeze({
    root: actualRoot,
    cell: entry.cell,
    rpc,
  });
  if (
    metadata.type !== "action" ||
    typeof metadata.name !== "string" ||
    metadata.name.length === 0 ||
    typeof metadata.componentPath !== "string" ||
    (metadata.visibility !== "public" && metadata.visibility !== "internal") ||
    pendingJournalEntries.get(input) !== entry ||
    entry.binding !== null ||
    !journalPointersMatch(state)
  )
    journalUnbound();
  const binding = Object.freeze({});
  journalBindings.set(binding, state);
  entry.binding = binding;
  return binding;
}
