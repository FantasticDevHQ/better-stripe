// Deterministic visual verification fixture. Never calls Stripe or executes business work.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UsageBilling, UsageHistory } from "../../src/react/index.js";
import {
  creditBalance,
  usageScope,
  usageSnapshot,
} from "../../src/react/workflows/Usage.fixtures.js";
import type { UsageBillingModel } from "../../src/client/usage/contracts.js";
import type { UsageBillingSnapshot } from "../../src/react/workflows/Usage.types.js";
function App() {
  const [model, setModel] = useState<UsageBillingModel>("pay_as_you_go");
  const [scenario, setScenario] = useState("delayed");
  const [tenant, setTenant] = useState("tenant1");
  const scope = { ...usageScope, accountKey: tenant, meterKey: `${model}-v1` };
  const load = async (): Promise<UsageBillingSnapshot> => {
    if (scenario === "unavailable")
      return {
        summary: {
          status: "unavailable",
          reason: "native_read_unavailable",
          retryable: true,
        },
      };
    const data = usageSnapshot(tenant === "tenant1" ? "14" : "3", model);
    data.provider = {
      status: "available",
      observedAt: 700,
      value: {
        period: scope.period,
        quantity: scenario === "delayed" ? "7" : "14",
        scaledQuantity: scenario === "delayed" ? "7000000" : "14000000",
        complete: scenario !== "delayed",
        stale: scenario === "delayed",
        nextCursor: scenario === "delayed" ? "provider_page2" : null,
        aggregationLagPossible: true,
        entries: [],
      },
    };
    if (model === "included_overage")
      data.allowance = {
        status: "available",
        observedAt: 700,
        value: {
          revision: 1,
          observedAt: 700,
          period: scope.period,
          accepting: true,
          policy: {
            reset: "billing_period",
            rollover: "none",
            entitled: true,
            overage: "allow",
            limit: { mode: "soft", quantity: "12" },
          },
          consumedQuantity: "14",
          reservedQuantity: "2",
          includedQuantity: "10",
          remainingIncludedQuantity: "0",
          billableOverageQuantity: "4",
          softLimitReached: true,
          hardLimitRemainingQuantity: null,
          committedEstimate: { amountDecimal: "8", currency: "usd" },
          projectedEstimate: { amountDecimal: "12", currency: "usd" },
          cashCollection: "none",
        },
      };
    if (model === "prepaid") {
      data.credits = {
        status: "available",
        observedAt: 700,
        value: {
          ...creditBalance,
          frozenQuantity: scenario === "held" ? "2" : "0",
          status: scenario === "held" ? "held" : "available",
        },
      };
      data.purchase = {
        purchaseId: "topup_fixture",
        state: scenario === "pending" ? "pending" : "ready",
        paymentIntentId: "pi_fixture",
        creditGrantId: scenario === "pending" ? null : "credgr_fixture",
        quantity: "10",
        amount: 20,
        currency: "usd",
      };
      data.creditApplication = {
        status: "unavailable",
        reason: "invoice_provenance_unavailable",
        retryable: true,
      };
    }
    return data;
  };
  return (
    <>
      <header>
        <small>BETTERSTRIPE / PACKAGE UI VERIFICATION</small>
        <h1>Metered billing, with its evidence intact.</h1>
        <p>
          Deterministic SDK UI fixtures. No Stripe calls, actual payments or
          native financial acceptance.
        </p>
      </header>
      <div id="controls">
        <label>
          Billing model{" "}
          <select
            value={model}
            onChange={(event) =>
              setModel(event.target.value as UsageBillingModel)
            }
          >
            <option value="pay_as_you_go">Pay as you go</option>
            <option value="included_overage">
              Included monthly usage with overages
            </option>
            <option value="prepaid">Prepaid credits</option>
          </select>
        </label>
        <label>
          {" "}
          Observation case{" "}
          <select
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            <option value="delayed">Delayed aggregation</option>
            <option value="observed">Native observed fixture</option>
            <option value="pending">Payment pending</option>
            <option value="held">Credits held</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <button
          onClick={() =>
            setTenant(tenant === "tenant1" ? "tenant2" : "tenant1")
          }
        >
          Switch tenant
        </button>
        <p className="case">
          Case: {model} / {scenario} / {tenant}
        </p>
      </div>
      <div className="columns">
        <UsageBilling
          key={`${model}:${scenario}`}
          scope={scope}
          unit="call"
          load={load}
        />
        <UsageHistory
          key={tenant}
          scope={scope}
          historyKey="fixture-events"
          limit={1}
          label="Consumption history"
          load={async (_scope, page) => ({
            status: "available",
            observedAt: 700,
            value: {
              records: [
                {
                  id: page.cursor ? "work2" : "work1",
                  quantity: page.cursor ? "6" : "8",
                },
              ],
              cursor: page.cursor ? null : "fixture_next",
              isDone: !!page.cursor,
            },
          })}
          getKey={(row: { id: string; quantity: string }) => row.id}
          renderRecord={(row) => (
            <p>
              {row.id}: {row.quantity} call · accepted locally, delivery unknown
            </p>
          )}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
