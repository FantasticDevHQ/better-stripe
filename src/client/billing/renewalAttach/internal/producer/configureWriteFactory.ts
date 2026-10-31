import { types } from "node:util";
import { COMPILED_CONFIGURE_WRITE_ENTRIES } from "../operations/sourceOperations.js";
import { closed } from "../operations/types.js";
import { readConfigureLineage } from "./configureLineage.js";
import { readAdmittedConfigurePreflight } from "./configurePreflight.js";
import { captureInitialStockRawDelegate } from "./stockDelegateFactory.js";
import { capturePreflightRecordDATA } from "../preflight/record.js";
import { expectedPlan, need, ownMethod } from "../configure/request.js";

const captures = new WeakSet<object>();
/** Derive a fixed write frame from actual completed readonly custody. */
export function captureAdmittedConfigureWriteFrame(
  token: object,
  arity: number,
) {
  need(typeof token === "object" && token !== null && !captures.has(token));
  captures.add(token);
  need(arity === 1);
  const lineage = readConfigureLineage(token);
  const preflight = readAdmittedConfigurePreflight(token);
  need(
    !types.isProxy(COMPILED_CONFIGURE_WRITE_ENTRIES) &&
      Array.isArray(COMPILED_CONFIGURE_WRITE_ENTRIES),
  );
  const candidates = COMPILED_CONFIGURE_WRITE_ENTRIES.filter((entry) => {
    const fields = closed(entry, ["originalEntry", "coversConfigure"]);
    ownMethod(entry, "coversConfigure");
    return fields.originalEntry === preflight.originalEntry;
  });
  need(candidates.length === 1);
  const entry = candidates[0],
    covers = ownMethod(entry, "coversConfigure");
  const record = preflight.output.originalRecord;
  const retained = capturePreflightRecordDATA(record);
  let closedFrame = false;
  function guard() {
    need(!closedFrame);
    try {
      const current = readConfigureLineage(token);
      need(
        current.owner === lineage.owner &&
          current.originalReservation === lineage.originalReservation &&
          current.journal === lineage.journal,
      );
      need(readAdmittedConfigurePreflight(token) === preflight);
      need(
        !types.isProxy(COMPILED_CONFIGURE_WRITE_ENTRIES) &&
          Array.isArray(COMPILED_CONFIGURE_WRITE_ENTRIES) &&
          COMPILED_CONFIGURE_WRITE_ENTRIES.includes(entry),
      );
      const fields = closed(entry, ["originalEntry", "coversConfigure"]);
      need(
        fields.originalEntry === preflight.originalEntry &&
          fields.coversConfigure === covers &&
          !types.isProxy(covers),
      );
    } catch (error) {
      closedFrame = true;
      throw error;
    }
  }
  guard();
  const delegate = captureInitialStockRawDelegate(lineage.parentToken);
  const expected = expectedPlan(record);
  const readPlan = Object.freeze(
    expected.map(({ resource, ordinal, method, path, body, options }) =>
      Object.freeze({ resource, ordinal, method, path, body, options }),
    ),
  );
  const frame = Object.freeze({
    owner: lineage.owner,
    operation: token,
    request: record.request,
    readPlan,
    delegate,
  });
  return Object.freeze({
    frame,
    expected,
    owner: lineage.owner,
    guard,
    record,
    retained,
    preflight,
    entry,
    covers,
  });
}
