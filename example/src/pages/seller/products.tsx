import { Fragment, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRole } from "@/providers/role-context";
import { useAction, useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { api } from "../../../convex/_generated/api";

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function SellerProducts() {
  const { currentUser } = useRole();
  const account = useQuery(api.queries.getAccountByUserId, {
    userId: currentUser.id,
  });
  const products = useQuery(
    api.queries.listProductsWithPricesByAccount,
    account?.stripeAccountId ? { accountId: account.stripeAccountId } : "skip",
  );
  const createProduct = useAction(api.actions.createProductForAccount);
  const createPrice = useAction(api.actions.createPrice);

  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddPriceFor, setShowAddPriceFor] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({ name: "", description: "" });
  const [newPrice, setNewPrice] = useState({
    amount: "",
    currency: "usd",
    interval: "month",
  });
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isCreatingPrice, setIsCreatingPrice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loading state
  if (account === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Card>
          <CardContent className="space-y-4 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // No account yet
  if (account === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Products</h1>
        <Alert>
          <AlertDescription>
            You need a Stripe Connect account before creating products. Visit
            the{" "}
            <a href="/seller/onboarding" className="text-primary underline">
              onboarding page
            </a>{" "}
            to get started.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Onboarding incomplete
  const onboardingStatus = account.onboardingStatus ?? "pending";
  if (onboardingStatus !== "complete") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">My Products</h1>
        <Alert>
          <AlertDescription>
            Complete your account onboarding before creating products. Visit the{" "}
            <a href="/seller/onboarding" className="text-primary underline">
              onboarding page
            </a>{" "}
            to continue.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleCreateProduct = async () => {
    setIsCreatingProduct(true);
    setError(null);
    try {
      await createProduct({
        name: newProduct.name,
        description: newProduct.description || undefined,
        accountId: account.stripeAccountId,
      });
      setNewProduct({ name: "", description: "" });
      setShowCreateDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingProduct(false);
    }
  };

  const handleAddPrice = async (stripeProductId: string) => {
    setIsCreatingPrice(true);
    setError(null);
    try {
      const interval = newPrice.interval as
        | "month"
        | "year"
        | "week"
        | "day"
        | "one_time";
      await createPrice({
        stripeProductId,
        unitAmount: Number(newPrice.amount),
        currency: newPrice.currency,
        type: interval === "one_time" ? "one_time" : "recurring",
        interval:
          interval === "one_time"
            ? undefined
            : (interval as "month" | "year" | "week" | "day"),
      });
      setNewPrice({ amount: "", currency: "usd", interval: "month" });
      setShowAddPriceFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingPrice(false);
    }
  };

  // Products still loading
  if (products === undefined) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Products</h1>
          <p className="text-muted-foreground text-sm">
            Create products and prices for your store.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Product
        </Button>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New Product</DialogTitle>
              <DialogDescription>
                Create a new product in your Stripe catalog. Customers will see
                this when purchasing.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="product-name">Name</Label>
                <Input
                  id="product-name"
                  value={newProduct.name}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, name: e.target.value })
                  }
                  placeholder="e.g. Premium Tee"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-description">Description</Label>
                <Input
                  id="product-description"
                  value={newProduct.description}
                  onChange={(e) =>
                    setNewProduct({
                      ...newProduct,
                      description: e.target.value,
                    })
                  }
                  placeholder="e.g. A premium cotton t-shirt"
                />
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateProduct}
                disabled={isCreatingProduct || !newProduct.name}
              >
                {isCreatingProduct ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Products Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prices</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <Fragment key={product._id}>
                <TableRow
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedProduct === product._id}
                  onClick={() =>
                    setExpandedProduct(
                      expandedProduct === product._id ? null : product._id,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedProduct(
                        expandedProduct === product._id ? null : product._id,
                      );
                    }
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {expandedProduct === product._id ? (
                        <ChevronDown className="text-muted-foreground h-4 w-4" />
                      ) : (
                        <ChevronRight className="text-muted-foreground h-4 w-4" />
                      )}
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {product.description ?? ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={product.active ? "default" : "secondary"}>
                      {product.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {product.prices.length} price
                    {product.prices.length !== 1 ? "s" : ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <div
                      className="flex justify-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setShowAddPriceFor(
                            showAddPriceFor === product._id
                              ? null
                              : product._id,
                          )
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add Price
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                {/* Expanded Prices */}
                {expandedProduct === product._id && (
                  <TableRow key={`${product._id}-prices`}>
                    <TableCell colSpan={4} className="bg-muted/30 p-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-muted-foreground text-sm font-medium">
                            Prices
                          </h4>
                        </div>

                        {/* Add Price Form (inline) */}
                        {showAddPriceFor === product._id && (
                          <Card>
                            <CardContent className="flex items-end gap-3 p-3">
                              <div className="grid gap-1.5">
                                <Label
                                  htmlFor={`add-price-amount-${product._id}`}
                                  className="text-xs"
                                >
                                  Amount (cents)
                                </Label>
                                <Input
                                  id={`add-price-amount-${product._id}`}
                                  type="number"
                                  value={newPrice.amount}
                                  onChange={(e) =>
                                    setNewPrice({
                                      ...newPrice,
                                      amount: e.target.value,
                                    })
                                  }
                                  className="w-28"
                                  placeholder="2900"
                                />
                              </div>
                              <div className="grid gap-1.5">
                                <Label
                                  htmlFor={`add-price-currency-${product._id}`}
                                  className="text-xs"
                                >
                                  Currency
                                </Label>
                                <Select
                                  value={newPrice.currency}
                                  onValueChange={(value: string | null) =>
                                    value &&
                                    setNewPrice({
                                      ...newPrice,
                                      currency: value,
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    id={`add-price-currency-${product._id}`}
                                    className="w-24"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="usd">USD</SelectItem>
                                    <SelectItem value="eur">EUR</SelectItem>
                                    <SelectItem value="gbp">GBP</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-1.5">
                                <Label
                                  htmlFor={`add-price-interval-${product._id}`}
                                  className="text-xs"
                                >
                                  Interval
                                </Label>
                                <Select
                                  value={newPrice.interval}
                                  onValueChange={(value: string | null) =>
                                    value &&
                                    setNewPrice({
                                      ...newPrice,
                                      interval: value,
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    id={`add-price-interval-${product._id}`}
                                    className="w-28"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="month">
                                      Monthly
                                    </SelectItem>
                                    <SelectItem value="year">Yearly</SelectItem>
                                    <SelectItem value="one_time">
                                      One-time
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                size="sm"
                                onClick={() =>
                                  handleAddPrice(product.stripeProductId)
                                }
                                disabled={isCreatingPrice || !newPrice.amount}
                              >
                                {isCreatingPrice ? "Adding..." : "Add"}
                              </Button>
                            </CardContent>
                          </Card>
                        )}

                        {/* Price Rows */}
                        {product.prices.length === 0 ? (
                          <p className="text-muted-foreground py-2 text-sm">
                            No prices yet. Add one to start selling.
                          </p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">
                                  Amount
                                </TableHead>
                                <TableHead className="text-xs">
                                  Interval
                                </TableHead>
                                <TableHead className="text-xs">Type</TableHead>
                                <TableHead className="text-xs">
                                  Status
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {product.prices.map((price) => (
                                <TableRow key={price._id}>
                                  <TableCell>
                                    {formatAmount(
                                      price.unitAmount,
                                      price.currency,
                                    )}
                                  </TableCell>
                                  <TableCell className="capitalize">
                                    {price.type === "one_time"
                                      ? "One-time"
                                      : `Per ${price.interval ?? "month"}`}
                                  </TableCell>
                                  <TableCell className="capitalize">
                                    {price.type.replace("_", " ")}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        price.active ? "default" : "secondary"
                                      }
                                    >
                                      {price.active ? "Active" : "Archived"}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {products.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center">
                  <Alert>
                    <AlertDescription>
                      No products yet. Create one to start selling.
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
