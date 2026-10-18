// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as ui from "../index.js";
afterEach(cleanup);
const scope = {
  identityKey: "admin-a",
  accountKey: "issuer-a",
  productKey: "calls",
  role: "admin" as const,
  ownershipLabel: "Issuer A",
  canConfigure: true,
  capability: "issuer_native" as const,
};
const initial = {
  plan: {
    key: "calls",
    version: "v2",
    model: "pay_as_you_go" as const,
    unit: { name: "call", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "2" },
  },
  eventName: "calls_v2",
  displayName: "API calls",
};
function field(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
function save() {
  fireEvent.submit(screen.getByRole("form", { name: "Usage configuration" }));
}
it("saves exact supported native terms, creates a version and never submits host ownership", async () => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  expect(
    screen.getByText(/Existing subscriptions keep their original prices/),
  ).toBeTruthy();
  field("Price per whole unit (USD)", "0.00125");
  field("Quantity precision", "2");
  save();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toEqual({
    ...initial,
    plan: {
      ...initial.plan,
      unit: { name: "call", precision: 2 },
      rate: { currency: "usd", unitAmountDecimal: "0.125" },
    },
  });
  expect(screen.getByRole("status").textContent).toMatch(/version saved/i);
});
it("validates included units against precision and native tier bounds, and resets per billing period", async () => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  field("Billing model", "included_overage");
  field("Included units per billing period", "0");
  save();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/included/i),
  );
  expect(onSave).not.toHaveBeenCalled();
  field("Included units per billing period", "9007199254740992");
  save();
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(onSave).not.toHaveBeenCalled();
  field("Included units per billing period", "100");
  save();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0].plan).toMatchObject({
    model: "included_overage",
    includedQuantity: "100",
    reset: "billing_period",
  });
  expect(screen.getByText(/Graduated pricing:/)).toBeTruthy();
});
it("configures paid credit packages, rejecting fractional backing and retaining issuer terms with manual top-up", async () => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  field("Billing model", "prepaid");
  field("Credit package quantity", "10");
  field("Price per whole unit (USD)", "0.001");
  save();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/whole minor/i),
  );
  expect(onSave).not.toHaveBeenCalled();
  field("Price per whole unit (USD)", "0.02");
  save();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toMatchObject({
    plan: { model: "prepaid", insufficientBalance: "reject" },
    creditPackage: { quantity: "10", topUp: "manual" },
  });
  expect(
    screen.getByText(/Reject work when credits are insufficient/),
  ).toBeTruthy();
  expect(screen.queryByLabelText(/owner/i)).toBeNull();
});
it("selects immutable authorized meters, disables incompatible meters and preserves their original version", async () => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ui.UsageConfiguration
      scope={{ ...scope, role: "seller" }}
      initial={initial}
      meters={[
        {
          id: "mtr_old",
          active: true,
          configuration: {
            ...initial,
            plan: { ...initial.plan, version: "v1" },
            eventName: "calls_v1",
          },
        },
        { id: "mtr_off", active: false, configuration: initial },
      ]}
      onSave={onSave}
    />,
  );
  field("Meter", "mtr_old");
  expect(
    (screen.getByLabelText("Plan version") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Price per whole unit (USD)") as HTMLInputElement)
      .value,
  ).toBe("0.02");
  save();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toMatchObject({
    meterId: "mtr_old",
    plan: { version: "v1" },
    eventName: "calls_v1",
  });
  expect(
    screen.getByRole("option", { name: /inactive/i }).getAttribute("disabled"),
  ).not.toBeNull();
});
it("locks duplicate submissions, sanitizes provider errors and allows a same-terms retry", async () => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  let reject!: (error: Error) => void;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    )
    .mockResolvedValue(undefined);
  render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  save();
  save();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByLabelText("Plan version") as HTMLInputElement).matches(
      ":disabled",
    ),
  ).toBe(true);
  await act(async () => reject(new Error("secret provider tenant-a")));
  expect(screen.getByRole("alert").textContent).toBe(
    "Configuration could not be saved. Retry the same terms or ask an administrator to reconcile the operation.",
  );
  save();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});
it.each([
  "identityKey",
  "accountKey",
  "productKey",
  "role",
  "ownershipLabel",
  "canConfigure",
  "capability",
])("discards pending results and edits on %s scope change", async (key) => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  let resolve!: () => void;
  const onSave = vi.fn().mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const { rerender } = render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  field("Plan version", "private-edit");
  save();
  const next = {
    ...scope,
    [key]:
      key === "canConfigure"
        ? false
        : key === "role"
          ? "seller"
          : key === "capability"
            ? "unsupported"
            : "scope-b",
  } as typeof scope;
  rerender(
    <ui.UsageConfiguration
      scope={next}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  await act(async () => resolve());
  expect(screen.queryByText(/version saved/i)).toBeNull();
  const version = screen.queryByLabelText(
    "Plan version",
  ) as HTMLInputElement | null;
  if (version) expect(version.value).toBe("v2");
});
it("leaves unavailable capability and read-only hosts unable to submit", () => {
  expect(ui.UsageConfiguration).toBeTypeOf("function");
  const onSave = vi.fn();
  const { rerender } = render(
    <ui.UsageConfiguration
      scope={{ ...scope, capability: "unsupported" }}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  expect(screen.getByText(/configuration unavailable/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  rerender(
    <ui.UsageConfiguration
      scope={{ ...scope, canConfigure: false }}
      initial={initial}
      meters={[]}
      onSave={onSave}
    />,
  );
  save();
  expect(onSave).not.toHaveBeenCalled();
});
it("shares configuration payloads between component and serialized HTTP host adapters", async () => {
  const componentSave = vi.fn().mockResolvedValue(undefined);
  const apiSave = vi
    .fn()
    .mockImplementation(async (value) => JSON.parse(JSON.stringify(value)));
  const { unmount } = render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={componentSave}
    />,
  );
  field("Billing model", "included_overage");
  field("Included units per billing period", "42");
  save();
  await waitFor(() => expect(componentSave).toHaveBeenCalledTimes(1));
  unmount();
  render(
    <ui.UsageConfiguration
      scope={scope}
      initial={JSON.parse(JSON.stringify(initial))}
      meters={[]}
      onSave={apiSave}
    />,
  );
  field("Billing model", "included_overage");
  field("Included units per billing period", "42");
  save();
  await waitFor(() => expect(apiSave).toHaveBeenCalledTimes(1));
  expect(apiSave.mock.calls[0][0]).toEqual(componentSave.mock.calls[0][0]);
});
it("exposes styling and render props without adding a second configuration engine", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ui.UsageConfiguration
      scope={scope}
      initial={initial}
      meters={[]}
      onSave={onSave}
    >
      {(state) => (
        <button
          onClick={() => {
            state.setField("version", "v3");
          }}
        >
          Edit version {state.fields.version}
          <span
            onClick={(event) => {
              event.stopPropagation();
              void state.save();
            }}
          >
            Submit
          </span>
        </button>
      )}
    </ui.UsageConfiguration>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").textContent).toContain("v3");
  fireEvent.click(screen.getByText("Submit"));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0].plan.version).toBe("v3");
});
