import * as React from "react";

import { cn } from "@/lib/utils";

function Label({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"label"> & { size?: "default" | "sm" }) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        size === "sm" && "text-xs",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
