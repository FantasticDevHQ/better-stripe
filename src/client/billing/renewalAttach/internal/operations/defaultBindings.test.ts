import { expect, it } from "vitest";
import {
  COMPILED_INITIAL_ENTRIES,
  COMPILED_RECOVERY_ENTRIES,
  COMPILED_PREFLIGHT_ENTRIES,
  ORIGINAL_ORIGIN_ASSOCIATION,
  loadFixedInitialOperation,
  loadFixedExplicitRecoveryOperation,
  loadOwnedConfigureOperation,
  loadOwnedTransportSource,
} from "./sourceOperations.js";

it("internal operation Source defaults bind no class, producer or origin", () => {
  for (const entries of [
    COMPILED_INITIAL_ENTRIES,
    COMPILED_RECOVERY_ENTRIES,
    COMPILED_PREFLIGHT_ENTRIES,
  ]) {
    expect(entries).toEqual([]);
    expect(Object.isFrozen(entries)).toBe(true);
  }
  expect(ORIGINAL_ORIGIN_ASSOCIATION).toBe(null);
  for (const load of [
    loadFixedInitialOperation,
    loadFixedExplicitRecoveryOperation,
    loadOwnedConfigureOperation,
    loadOwnedTransportSource,
  ])
    expect(load).toThrow(/UNBOUND/);
});

it("normal actor captures stay EMPTY and consume each invocation without Source access", async () => {
  const { captureOwnedInitialAttachV2 } = await import("./initialAttach.js");
  const { captureOwnedExplicitAttachRecoveryV2 } =
    await import("../recovery/recoveryActor.js");
  for (const { capture, reason } of [
    {
      capture: captureOwnedInitialAttachV2,
      reason: "no_qualified_native_class",
    },
    {
      capture: captureOwnedExplicitAttachRecoveryV2,
      reason: "no_qualified_recovery_class",
    },
  ]) {
    expect(() => Reflect.apply(capture, undefined, [{}])).toThrow(
      "INITIAL_ACTOR_STOP",
    );
    const handle = capture();
    expect(await handle.invoke()).toMatchObject({
      status: "not_dispatched",
      reason,
      operationalAuthority: false,
    });
    expect(await handle.invoke()).toMatchObject({
      reason: "invocation_consumed",
    });
    await expect(Reflect.apply(handle.invoke, handle, [{}])).rejects.toThrow(
      "INITIAL_ACTOR_STOP",
    );
  }
});

it("stage-specific transport Source loaders remain UNBOUND", async () => {
  const { loadInitialOwnedTransportSource, loadRecoveryOwnedTransportSource } =
    await import("./sourceOperations.js");
  expect(loadInitialOwnedTransportSource).toThrow(/UNBOUND/);
  expect(loadRecoveryOwnedTransportSource).toThrow(/UNBOUND/);
});
