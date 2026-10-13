import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm" | "inset" | "panel";
  variant?: "default" | "interactive" | "muted";
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(
        "group/card bg-card text-card-foreground ring-foreground/10 flex flex-col gap-4 overflow-hidden rounded-xl py-4 text-sm ring-1 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        size === "panel" && "gap-0 p-6",
        size === "inset" && "p-4",
        variant === "interactive" && "transition-colors hover:ring-primary/50",
        variant === "muted" && "bg-muted/40",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({
  className,
  spacing = "default",
  ...props
}: React.ComponentProps<"div"> & { spacing?: "default" | "compact" }) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-card-header has-data-[slot=card-description]:grid-rows-card-header [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        spacing === "compact" && "pb-2",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "metric" }) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        variant === "metric" && "text-sm font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

const contentPadding = {
  default: "px-4 group-data-[size=sm]/card:px-3",
  sm: "p-3",
  lg: "p-6",
  status: "px-4 py-8 group-data-[size=sm]/card:px-3",
  section: "px-4 pt-6 group-data-[size=sm]/card:px-3",
};

function CardContent({
  className,
  padding = "default",
  ...props
}: React.ComponentProps<"div"> & { padding?: keyof typeof contentPadding }) {
  return (
    <div
      data-slot="card-content"
      className={cn(contentPadding[padding], className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "bg-muted/50 flex items-center rounded-b-xl border-t p-4 group-data-[size=sm]/card:p-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
