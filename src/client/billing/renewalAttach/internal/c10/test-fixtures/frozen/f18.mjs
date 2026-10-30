import { instantiateRequired } from "./f24.mjs";
export const copy = (x) => structuredClone(x);
export function fixture() {
  const s = instantiateRequired();
  return {
    retainedAttach: {
      attachRequest: copy(s.attach.attachRequest),
      intent: "initial",
    },
    freshAttach: {
      attachRequest: copy(s.attach.attachRequest),
      intent: "initial",
      freshSubscription: copy(s.attach.attachRequest.preparation.subscription),
      targetPrice: copy(s.attach.attachRequest.preparation.targetPrice),
      billingCustomer: copy(s.attach.attachRequest.preparation.billingCustomer),
      observedAt: s.attach.attachRequest.firstDispatchedAt,
    },
    retainedConfigure: {
      configuration: copy(s.configuration),
      intent: "initial",
    },
    freshConfigure: {
      configuration: copy(s.configuration),
      intent: "initial",
      freshSubscription: copy(s.configuration.freshSubscription),
      targetPrice: copy(s.configuration.targetPrice),
      billingCustomer: copy(s.configuration.billingCustomer),
      schedule: copy(s.configuration.schedule),
      observedAt: s.configuration.observedAt,
    },
  };
}
