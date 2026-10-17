import type Stripe from "stripe";
import {
  createFunctionHandle,
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";
import type { Component } from "../helpers.js";
import {
  captureBalanceFundingOriginal,
  getBalanceFundingCapability,
} from "../billing/balanceFunding.js";
import { resolveOwnerAccount } from "../utils/owner.js";
import {
  FUNDING_WORKFLOW_VERSION,
  type ProviderResult,
} from "../../component/balanceFunding/workflowSchema.js";
import type { FundingPhaseRef } from "../../component/balanceFunding/workflowValidators.js";
export type FundingProviderPhaseOptions = Omit<
  FundingPhaseRef,
  "operationId"
> & { operationId: string };
export type FundingProviderPhaseResult = ProviderResult;
type Context = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
export type FundingOperationReference = {
  accountId: string;
  scopeKey: string;
  stripeSubscriptionId: string;
  operationId: string;
  version: number;
};
export type PrepareFundingWorkflowOptions = {
  accountId: string;
  scopeKey: string;
  stripeSubscriptionId: string;
  requestKey: string;
  consent: true;
  consentAt: number;
  consentReference: string;
  providerAction: FunctionReference<"action", "public" | "internal">;
};
const uncertain = (): ProviderResult => ({
  status: "unknown",
  reason: "provider_outcome_unknown",
  retryable: false,
});
export class BalanceFundingWorkflowClient {
  constructor(
    private readonly component: Component,
    private readonly provider: () => Stripe,
    private readonly apiVersion: string,
  ) {}
  private reference(args: FundingOperationReference) {
    return {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      stripeSubscriptionId: args.stripeSubscriptionId,
      version: args.version,
      operationId: args.operationId as GenericId<"balanceFundingOperations">,
      providerApiVersion: this.apiVersion,
      definitionVersion: FUNDING_WORKFLOW_VERSION,
    };
  }
  async prepare(ctx: Context, options: PrepareFundingWorkflowOptions) {
    if (
      !getBalanceFundingCapability(this.apiVersion).configured ||
      options.consent !== true
    )
      return {
        status: "rejected" as const,
        reason: "policy_invalid" as const,
        retryable: false as const,
      };
    const { providerAction, consentAt, consentReference, ...lookup } = options;
    const query = { ...lookup, providerApiVersion: this.apiVersion };
    const prior = await ctx.runQuery(
      this.component.balanceFunding.queries.findPreparationOperation,
      query,
    );
    let operation;
    if (prior && "operationId" in prior) operation = prior;
    else if (prior) return prior;
    else {
      const { requestKey: _requestKey, consent: _consent, ...scope } = lookup;
      const saved = await ctx.runQuery(
        this.component.balanceFunding.queries.readScopePreparation,
        { ...scope, providerApiVersion: this.apiVersion },
      );
      if (saved && "status" in saved) return saved;
      const captured =
        saved?.preparation ??
        (await captureBalanceFundingOriginal(this.provider(), this.apiVersion, {
          customerAccount: options.accountId,
          stripeSubscriptionId: options.stripeSubscriptionId,
          consent: true,
        }));
      const {
        customerAccount,
        stripeSubscriptionId,
        previousPaymentMethodId,
        previousPaymentMethodTypes,
      } = captured;
      const intent = await ctx.runMutation(
        this.component.balanceFunding.mutations.prepare,
        {
          accountId: options.accountId,
          scopeKey: options.scopeKey,
          requestKey: options.requestKey,
          consent: true,
          consentAt: saved?.consentAt ?? consentAt,
          consentReference: saved?.consentReference ?? consentReference,
          providerApiVersion: this.apiVersion,
          preparation: {
            customerAccount,
            stripeSubscriptionId,
            previousPaymentMethodId,
            previousPaymentMethodTypes,
          },
        },
      );
      if (intent.status !== "accepted") return intent;
      operation = intent.operation;
    }
    return ctx.runMutation(
      this.component.balanceFunding.mutations.startWorkflow,
      {
        ...this.reference({
          ...operation,
          stripeSubscriptionId: options.stripeSubscriptionId,
        }),
        providerAction: await createFunctionHandle(providerAction),
      },
    );
  }
  async apply(
    ctx: Context,
    options: {
      accountId: string;
      scopeKey: string;
      stripeSubscriptionId: string;
      preparationId: string;
      enabled: boolean;
      consent?: true;
      requestKey: string;
      providerAction: FunctionReference<"action", "public" | "internal">;
    },
  ) {
    if (!getBalanceFundingCapability(this.apiVersion).configured)
      return {
        status: "rejected" as const,
        reason: "policy_invalid" as const,
        retryable: false as const,
      };
    const preparation = await ctx.runQuery(
      this.component.balanceFunding.queries.readPreparation,
      {
        accountId: options.accountId,
        scopeKey: options.scopeKey,
        stripeSubscriptionId: options.stripeSubscriptionId,
        preparationId: options.preparationId,
      },
    );
    if (!preparation || preparation.providerApiVersion !== this.apiVersion)
      return {
        status: "conflict" as const,
        reason: "identity_changed" as const,
        retryable: false as const,
      };
    const result = await ctx.runMutation(
      this.component.balanceFunding.mutations.begin,
      {
        accountId: options.accountId,
        scopeKey: options.scopeKey,
        preparationId: options.preparationId,
        enabled: options.enabled,
        ...(options.consent === true ? { consent: true as const } : {}),
        requestKey: options.requestKey,
      },
    );
    if (result.status !== "accepted") return result;
    return ctx.runMutation(
      this.component.balanceFunding.mutations.startWorkflow,
      {
        ...this.reference({
          ...result.operation,
          stripeSubscriptionId: options.stripeSubscriptionId,
        }),
        providerAction: await createFunctionHandle(options.providerAction),
      },
    );
  }
  inspect(ctx: Context, args: FundingOperationReference) {
    return ctx.runQuery(this.component.balanceFunding.queries.getOperation, {
      accountId: args.accountId,
      scopeKey: args.scopeKey,
      operationId: args.operationId,
      version: args.version,
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
  }
  resume(ctx: Context, args: FundingOperationReference) {
    return ctx.runMutation(
      this.component.balanceFunding.mutations.resumeWorkflow,
      this.reference(args),
    );
  }
  cancel(ctx: Context, args: FundingOperationReference) {
    return ctx.runMutation(
      this.component.balanceFunding.mutations.cancelWorkflow,
      this.reference(args),
    );
  }
  async executeProviderPhase(
    ctx: Context,
    input: FundingProviderPhaseOptions,
  ): Promise<ProviderResult> {
    const args = {
      ...input,
      operationId: input.operationId as GenericId<"balanceFundingOperations">,
    };
    try {
      const stripe = this.provider();
      if (
        args.providerApiVersion !== this.apiVersion ||
        stripe.getApiField("version") !== args.providerApiVersion ||
        !getBalanceFundingCapability(this.apiVersion).configured
      )
        return {
          status: "conflict",
          reason: "revision_changed",
          retryable: false,
        };
      const claim = await ctx.runMutation(
        this.component.balanceFunding.mutations.claimProviderPhase,
        args,
      );
      if (claim.status !== "claimed") return claim;
      const operation = await ctx.runQuery(
        this.component.balanceFunding.queries.inspectOperation,
        {
          accountId: args.accountId,
          scopeKey: args.scopeKey,
          operationId: args.operationId,
          version: args.version,
          stripeSubscriptionId: args.stripeSubscriptionId,
        },
      );
      if (!operation) return uncertain();
      const saved = await ctx.runQuery(
        this.component.balanceFunding.queries.readPreparation,
        {
          accountId: args.accountId,
          scopeKey: args.scopeKey,
          preparationId: operation.preparationId,
          stripeSubscriptionId: args.stripeSubscriptionId,
        },
      );
      if (!saved || saved.providerApiVersion !== args.providerApiVersion)
        return uncertain();
      const prep = saved.preparation;
      if (args.phase === "apply") {
        if (!prep.paymentMethodId || !saved.verified) return uncertain();
        const method = await stripe.paymentMethods.retrieve(
          prep.paymentMethodId,
        );
        if (
          method.id !== prep.paymentMethodId ||
          method.type !== "stripe_balance" ||
          resolveOwnerAccount(method) !== args.accountId
        )
          return uncertain();
        let sub = await stripe.subscriptions.retrieve(
          args.stripeSubscriptionId,
        );
        const matches = (id: string | null, types: string[] | null) => {
          const pm =
            typeof sub.default_payment_method === "string"
              ? sub.default_payment_method
              : (sub.default_payment_method?.id ?? null);
          const actual = sub.payment_settings?.payment_method_types ?? null;
          return (
            pm === id &&
            JSON.stringify(actual === null ? null : [...actual].sort()) ===
              JSON.stringify(types === null ? null : [...types].sort())
          );
        };
        const valid = () =>
          sub.id === args.stripeSubscriptionId &&
          sub.object === "subscription" &&
          resolveOwnerAccount(sub) === args.accountId &&
          ["active", "trialing", "past_due"].includes(sub.status);
        const targetMethod = operation.enabled
          ? prep.paymentMethodId
          : prep.previousPaymentMethodId;
        const targetTypes = operation.enabled
          ? ["stripe_balance"]
          : prep.previousPaymentMethodTypes;
        if (!valid()) return uncertain();
        if (!matches(targetMethod, targetTypes)) {
          if (
            claim.mode !== "execute" ||
            (!matches(
              prep.previousPaymentMethodId,
              prep.previousPaymentMethodTypes,
            ) &&
              !matches(prep.paymentMethodId, ["stripe_balance"]))
          )
            return uncertain();
          await stripe.subscriptions.update(
            sub.id,
            {
              default_payment_method: targetMethod ?? "",
              payment_settings: {
                payment_method_types:
                  (targetTypes as Stripe.SubscriptionUpdateParams.PaymentSettings.PaymentMethodType[]) ??
                  "",
              },
            },
            { idempotencyKey: args.providerKey, maxNetworkRetries: 0 },
          );
          sub = await stripe.subscriptions.retrieve(args.stripeSubscriptionId);
          if (!valid() || !matches(targetMethod, targetTypes))
            return uncertain();
        }
        return {
          status: "ready",
          value: {
            phase: "apply",
            customerAccount: args.accountId,
            stripeSubscriptionId: args.stripeSubscriptionId,
            providerApiVersion: args.providerApiVersion,
            paymentMethodId: targetMethod,
            paymentMethodTypes: targetTypes,
            enabled: operation.enabled,
          },
        };
      }
      let paymentMethodId = claim.paymentMethodId;
      if (args.phase === "create") {
        const method = await stripe.paymentMethods.create(
          { type: "stripe_balance" },
          { idempotencyKey: args.providerKey, maxNetworkRetries: 0 },
        );
        if (
          !method.id ||
          method.object !== "payment_method" ||
          method.type !== "stripe_balance" ||
          resolveOwnerAccount(method)
        )
          return uncertain();
        paymentMethodId = method.id;
      } else {
        if (!paymentMethodId) return uncertain();
        let method = await stripe.paymentMethods.retrieve(paymentMethodId);
        if (
          method.id !== paymentMethodId ||
          method.object !== "payment_method" ||
          method.type !== "stripe_balance"
        )
          return uncertain();
        if (!resolveOwnerAccount(method) && claim.mode === "execute") {
          await stripe.paymentMethods.attach(
            paymentMethodId,
            { customer_account: args.accountId },
            { idempotencyKey: args.providerKey, maxNetworkRetries: 0 },
          );
          method = await stripe.paymentMethods.retrieve(paymentMethodId);
        }
        if (
          method.id !== paymentMethodId ||
          resolveOwnerAccount(method) !== args.accountId
        )
          return uncertain();
        const sub = await stripe.subscriptions.retrieve(
          args.stripeSubscriptionId,
        );
        if (
          sub.id !== args.stripeSubscriptionId ||
          resolveOwnerAccount(sub) !== args.accountId ||
          !["active", "trialing", "past_due"].includes(sub.status)
        )
          return uncertain();
        const currentMethod =
          typeof sub.default_payment_method === "string"
            ? sub.default_payment_method
            : (sub.default_payment_method?.id ?? null);
        const currentTypes = sub.payment_settings?.payment_method_types ?? null;
        if (
          currentMethod !== prep.previousPaymentMethodId ||
          JSON.stringify(
            currentTypes === null ? null : [...currentTypes].sort(),
          ) !==
            JSON.stringify(
              prep.previousPaymentMethodTypes === null
                ? null
                : [...prep.previousPaymentMethodTypes].sort(),
            )
        )
          return uncertain();
      }
      return {
        status: "ready",
        value: {
          phase: args.phase,
          customerAccount: args.accountId,
          stripeSubscriptionId: args.stripeSubscriptionId,
          providerApiVersion: args.providerApiVersion,
          paymentMethodId: paymentMethodId!,
        },
      };
    } catch {
      return uncertain();
    }
  }
}
