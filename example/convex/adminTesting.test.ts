import { describe, expect, it } from "vitest";

import { describeLedgerSync } from "./adminTesting";

/**
 * The admin Testing page (BTS-45) fires real Stripe test-mode events and then
 * polls the component ledger for the resulting row, so the page can honestly
 * report whether the event actually round-tripped through the webhook
 * pipeline (vs. just being accepted by Stripe). The live polling needs a
 * deployment; this message-formatting logic is pure and unit-tested here.
 */
describe("describeLedgerSync (BTS-45 real-webhook triggers)", () => {
  it("reports a successful sync with the attempt count it took", () => {
    expect(describeLedgerSync(true, 1, 5)).toBe(
      "Synced to the component ledger after 1/5 poll.",
    );
    expect(describeLedgerSync(true, 3, 5)).toBe(
      "Synced to the component ledger after 3/5 polls.",
    );
  });

  it("reports an actionable message when the row never appeared", () => {
    const message = describeLedgerSync(false, 5, 5);
    expect(message).toContain("Not yet synced after 5 polls");
    expect(message).toContain("stripe listen");
  });
});
