import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useWorkflowAction,
  type UsageConfigurationProps,
} from "@fantastic.dev/better-stripe/react";
import type {
  UsageBillingModel,
  UsageConfigurationValue,
} from "@fantastic.dev/better-stripe/usage";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { productConfiguration } from "../../convex/meteredProducts/policy";
import { useRole } from "@/providers/role-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { IntegrationExamples } from "./integration-examples";
import {
  ComponentProductConfiguration,
  HeadlessProductConfiguration,
} from "./product-usage-configuration";
import { SavedOffer } from "./metered-product-terms";
import { MeteredEnrollment } from "./metered-product-enrollment";
import "./metered-usage.css";
const models = [
  { key: "pay_as_you_go", label: "Pay as you go" },
  { key: "included_overage", label: "Included monthly usage" },
  { key: "prepaid", label: "Prepaid credits" },
] as const;
export function MeteredProducts() {
  const { currentUser, currentRole, sellers } = useRole();
  if (!currentUser.id || !["customer", "seller", "admin"].includes(currentRole))
    return (
      <EmptyState>
        Choose a customer, seller or admin persona to explore product metered
        billing.
      </EmptyState>
    );
  return (
    <ProductPage
      key={currentUser.id}
      actorId={currentUser.id as Id<"users">}
      role={currentRole}
      name={
        sellers?.find((seller) => seller.id === currentUser.id)?.name ??
        currentUser.name
      }
    />
  );
}
function ProductPage({
  actorId,
  role,
  name,
}: {
  actorId: Id<"users">;
  role: string;
  name: string;
}) {
  const offers = useQuery(api.meteredProducts.catalog.list, { actorId });
  const owner = role === "admin" || role === "seller";
  return (
    <div data-usage-demo="" className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {role === "seller"
            ? `${name} · metered billing`
            : role === "admin"
              ? "Product billing & store access"
              : "Your metered services"}
        </h1>
        <p className="text-muted-foreground">
          {owner
            ? "Attach recurring fees, included units and usage prices to your products."
            : "Subscribe to coaching minutes, or buy credits for platform reports. Your usage stays with the product you purchased."}
        </p>
      </header>
      {role === "admin" && <StoreAccess actorId={actorId} />}
      {offers === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : owner ? (
        <OwnerProducts
          actorId={actorId}
          role={role}
          name={name}
          offers={offers}
        />
      ) : (
        <CustomerProducts actorId={actorId} offers={offers} />
      )}
      {role === "admin" && (
        <Link
          className="text-sm underline"
          to="/demo/metered-usage?diagnostics=protocol"
        >
          Developer protocol diagnostics
        </Link>
      )}
      <p className="text-xs text-muted-foreground">
        This example uses Stripe test mode and demo personas. Demo personas are
        not production authentication.
      </p>
    </div>
  );
}
function StoreAccess({ actorId }: { actorId: Id<"users"> }) {
  const stores = useQuery(api.meteredProducts.catalog.stores, { actorId });
  const setEnabled = useMutation(api.meteredProducts.catalog.setEnabled);
  const task = useWorkflowAction(
    async (sellerId: Id<"users">, enabled: boolean) => {
      try {
        await setEnabled({ actorId, sellerId, enabled });
        return "Store access saved.";
      } catch {
        throw new Error("Store access could not be saved. Try again.");
      }
    },
    actorId,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Store access</CardTitle>
        <CardDescription>
          Enable metered products per store. Disabling stops new product setup
          and new enrollments. Existing customers keep their purchased terms and
          history.
        </CardDescription>
      </CardHeader>
      <CardContent aria-busy={task.isPending}>
        <div className="space-y-4">
          {stores?.map((store) => (
            <div
              key={store.id}
              className="flex items-center justify-between gap-4"
            >
              <Label htmlFor={`metered-${store.id}`}>{store.name}</Label>
              <Switch
                id={`metered-${store.id}`}
                aria-label={`Metered billing for ${store.name}`}
                checked={store.enabled}
                disabled={task.isPending}
                onCheckedChange={(enabled) => void task.run(store.id, enabled)}
              />
            </div>
          ))}
          {task.isPending && <p role="status">Saving store access…</p>}
          {task.error && (
            <p role="alert" className="text-sm text-destructive">
              {task.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function OwnerProducts({
  actorId,
  role,
  name,
  offers,
}: {
  actorId: Id<"users">;
  role: string;
  name: string;
  offers: Doc<"meteredProductOffers">[];
}) {
  const enabled = useQuery(api.meteredProducts.catalog.enabled, { actorId });
  const [params] = useSearchParams();
  const [selected, select] = useState(params.get("product") ?? "");
  const [cursor, setCursor] = useState<string>();
  const productPage = useQuery(api.meteredProducts.catalog.products, {
    actorId,
    cursor,
    selectedProductId: selected || undefined,
  });
  const products = productPage?.products;
  const product =
    products?.find((item) => item.id === selected) ??
    products?.find((item) =>
      (role === "admin" ? /report/i : /coach/i).test(item.name),
    ) ??
    products?.[0];
  const [model, setModel] = useState<UsageBillingModel>("included_overage");
  if (enabled === undefined || products === undefined)
    return <Skeleton className="h-64 w-full" />;
  if (!enabled)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Metered billing is disabled for this store</CardTitle>
          <CardDescription>
            This store sells its regular products without usage charges. An
            admin can enable metered billing in Store access when the store
            needs it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  const offer = offers.find((item) => item.productId === product?.id);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {role === "admin" ? "Platform service products" : "Product billing"}
          </CardTitle>
          <CardDescription>
            {role === "admin"
              ? "For example, store analytics reports sold by the platform. Prepaid credits apply only to these issuer-owned services."
              : "For example, a $20 monthly coaching membership includes 60 one-on-one minutes, then $1 per extra minute."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="metered-product">Attach billing to product</Label>
              <Select
                value={product?.id ?? ""}
                onValueChange={(value) => select(value ?? "")}
              >
                <SelectTrigger id="metered-product" className="w-full">
                  <SelectValue placeholder="Choose a product">
                    {product?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {products.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                {cursor && (
                  <Button
                    variant="outline"
                    onClick={() => setCursor(undefined)}
                  >
                    Newest products
                  </Button>
                )}
                {productPage && !productPage.done && (
                  <Button
                    variant="outline"
                    onClick={() => setCursor(productPage.cursor)}
                  >
                    Older products
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                <Link
                  className="underline"
                  to={role === "admin" ? "/admin/products" : "/seller/products"}
                >
                  Create or manage catalog products
                </Link>
              </p>
            </div>
            {product ? (
              <>
                {offer?.providerJson && <SavedOffer offer={offer} />}
                <div
                  className="flex flex-wrap gap-2"
                  aria-label="Billing models"
                >
                  {models
                    .filter(
                      (item) => role === "admin" || item.key !== "prepaid",
                    )
                    .map((item) => (
                      <Button
                        key={item.key}
                        disabled={!!offer}
                        aria-pressed={
                          (offer
                            ? JSON.parse(offer.configurationJson).plan.model
                            : model) === item.key
                        }
                        variant={
                          (offer
                            ? JSON.parse(offer.configurationJson).plan.model
                            : model) === item.key
                            ? "default"
                            : "outline"
                        }
                        onClick={() => setModel(item.key)}
                      >
                        {item.label}
                      </Button>
                    ))}
                </div>
                <ConfigureProduct
                  key={`${product.id}:${model}`}
                  actorId={actorId}
                  product={product}
                  role={role}
                  name={name}
                  model={
                    offer
                      ? JSON.parse(offer.configurationJson).plan.model
                      : model
                  }
                  offer={offer}
                />
              </>
            ) : (
              <EmptyState>
                Create a catalog product first, then attach its metered billing
                terms here.
              </EmptyState>
            )}
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Customers enroll from Your metered services. Mixed monthly-fee and usage
        invoices can be paid, but automatic seller transfers remain held because
        the current settlement verifier does not support mixed invoices.
      </p>
    </div>
  );
}
function ConfigureProduct({
  actorId,
  product,
  role,
  name,
  model,
  offer,
}: {
  actorId: Id<"users">;
  product: { id: string; name: string };
  role: string;
  name: string;
  model: UsageBillingModel;
  offer?: Doc<"meteredProductOffers">;
}) {
  const configure = useAction(api.meteredProducts.native.configure);
  const [base, setBase] = useState(
    offer
      ? (offer.baseAmount / 100).toFixed(2)
      : model === "included_overage"
        ? "20.00"
        : "0.00",
  );
  const initial: UsageConfigurationValue = offer
    ? JSON.parse(offer.configurationJson)
    : productConfiguration(
        model,
        product.name,
        role === "admin" ? "reports" : "coaching",
      );
  const props: UsageConfigurationProps & {
    base: string;
    setBase: (value: string) => void;
  } = {
    scope: {
      identityKey: actorId,
      accountKey: actorId,
      productKey: product.id,
      role: role === "seller" ? "seller" : "admin",
      ownershipLabel: name,
      canConfigure: !offer?.providerJson,
      capability: "issuer_native",
    },
    initial,
    meters: [],
    base,
    setBase,
    onSave: async (configuration) => {
      if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(base))
        throw new Error(
          "Enter a monthly amount with at most two decimal places.",
        );
      const [whole, fraction = ""] = base.split(".");
      const baseAmount =
        model === "prepaid"
          ? 0
          : Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
      await configure({
        actorId,
        productId: product.id,
        baseAmount,
        configurationJson: JSON.stringify(configuration),
      });
    },
  };
  return (
    <IntegrationExamples
      headless={<HeadlessProductConfiguration {...props} />}
      components={<ComponentProductConfiguration {...props} />}
      note="Both implementations call the same authorized product API. Prices remain fixed once attached; create another product for different terms."
    />
  );
}
function CustomerProducts({
  actorId,
  offers,
}: {
  actorId: Id<"users">;
  offers: Doc<"meteredProductOffers">[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        Choose a metered product to see its monthly fee, included units and
        overage rate before purchasing.
      </p>
      {offers.length === 0 ? (
        <EmptyState>
          No metered products are available yet. Choose Maya's seller persona to
          attach coaching billing, or the admin persona to configure platform
          report credits.
        </EmptyState>
      ) : (
        offers.map((offer) => (
          <MeteredEnrollment key={offer._id} actorId={actorId} offer={offer} />
        ))
      )}
    </div>
  );
}
