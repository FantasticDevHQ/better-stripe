import { OWNER } from "../originalOwner.js";
// Child completion closes this reader, not the original invocation owner.
const stop = () => {
  throw Error("RAW_ACQUISITION_STOP");
};
export function createReadLifetime(sourceOwner: typeof OWNER) {
  const basis = sourceOwner.basis;
  let state = "unused",
    last: { wallMs: number; ns: bigint } | null = null;
  const wall = (v: number) => Number.isSafeInteger(v) && v >= 0,
    ns = (v: unknown) =>
      typeof v === "bigint" && v >= 0n && v <= 18446744073709551615n;
  const valid =
    wall(basis.startWallMs) &&
    wall(basis.workEndWallMs) &&
    wall(basis.endWallMs) &&
    ns(basis.startNs) &&
    ns(basis.workEndNs) &&
    ns(basis.endNs) &&
    basis.startWallMs < basis.workEndWallMs &&
    basis.workEndWallMs <= basis.endWallMs &&
    basis.startNs < basis.workEndNs &&
    basis.workEndNs <= basis.endNs;
  function check() {
    if (state !== "running") stop();
    const x = sourceOwner.sample();
    if (
      !valid ||
      !x ||
      !wall(x.wallMs) ||
      !ns(x.ns) ||
      x.retired !== false ||
      x.wallMs < basis.startWallMs ||
      x.ns < basis.startNs ||
      x.wallMs >= basis.workEndWallMs ||
      x.ns >= basis.workEndNs ||
      x.wallMs >= basis.endWallMs ||
      x.ns >= basis.endNs ||
      (last && (x.wallMs < last.wallMs || x.ns < last.ns))
    ) {
      state = "stopped";
      stop();
    }
    last = { wallMs: x.wallMs, ns: x.ns };
    return last;
  }
  return Object.freeze({
    begin() {
      if (state !== "unused") return false;
      state = "running";
      check();
      return true;
    },
    check,
    finish() {
      const x = check();
      state = "readclosed";
      return x;
    },
    fail() {
      state = "stopped";
    },
  });
}
